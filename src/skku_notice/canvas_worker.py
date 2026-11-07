# ruff: noqa: E501  (한국어 문구와 상태 열 이름이 한 줄에 있다)
"""Read each user's iCampus (Canvas) deadlines with the user's own token and queue alerts.

The original service read one personal token and always reported "일정을 모두 확인하지 못했어요" when any step
(course list, lecture contents session, modules, quizzes) failed, without saying which one. Here every
incomplete step records a plain reason on the token row, so the cause is visible in the logs and in the database.
Alerts are only queued here; the push worker (which holds the VAPID key) delivers them.
Never log tokens, ciphertext or exception texts that could carry them.
"""

import contextlib
import io
import os
import re
from dataclasses import replace
from datetime import UTC, datetime, time, timedelta

from skku_notice.byok_crypto import ByokCryptoError, decrypt_api_key
from skku_notice.canvas import CanvasError, read_canvas
from skku_notice.canvas_alerts import CanvasAlert, CanvasState, mark_sent, plan_alerts, problem_alert
from skku_notice.scheduled_collection import NoticeStore, StoreError

MAX_USERS_PER_RUN = 20
MIN_GAP = timedelta(minutes=61)  # LearningX is launched at most once an hour per user
LEADS = [1440, 180]
SUMMARY_TIME = time(21, 0)
REJECTED = "아이캠퍼스가 이 토큰을 받아 주지 않아요. 토큰을 다시 등록해 주세요."
INCOMPLETE_TITLE = "아이캠퍼스 일정을 모두 확인하지 못했어요"
INCOMPLETE_BODY = "잠시 뒤 다시 확인할게요. 아이캠퍼스에서도 확인할 수 있어요"


def alert_kind(alert: CanvasAlert) -> str:
    """summary: the daily summary, problem: the connection broke, deadline: a reminder before a due time."""
    if alert.summary_day:
        return "summary"
    return "problem" if alert.title == "아이캠퍼스 연결이 끊겼어요" else "deadline"


def summary_time_of(value: object) -> time:
    """The user's daily summary time (HH:MM or HH:MM:SS from the database); 21:00 when missing or invalid."""
    try:
        hour, minute = str(value).split(":")[:2]
        return time(int(hour), int(minute))
    except (ValueError, TypeError):
        return SUMMARY_TIME


def state_from_row(raw: dict | None) -> CanvasState:
    raw = raw or {}
    return CanvasState(
        notified=raw.get("notified") if isinstance(raw.get("notified"), dict) else {},
        summary_sent_on=raw.get("summary_sent_on"),
        problem=raw.get("problem"),
        initialized=bool(raw.get("initialized", False)),
        last_learningx_launch=raw.get("last_learningx_launch"),
        partial_summary_sent_on=raw.get("partial_summary_sent_on"),
    )


def state_to_row(state: CanvasState) -> dict:
    return {
        "notified": state.notified, "summary_sent_on": state.summary_sent_on,
        "partial_summary_sent_on": state.partial_summary_sent_on, "problem": state.problem,
        "initialized": state.initialized, "last_learningx_launch": state.last_learningx_launch,
    }


def safe_reason(text: str, token: str) -> str | None:
    """A short plain reason for the user and the logs. The token never appears in it."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    clean = " / ".join(dict.fromkeys(line.replace(token, "…") for line in lines))
    clean = re.sub(r"[\x00-\x1f\x7f]", " ", clean)
    return clean[:280] or None


class CanvasStore(NoticeStore):
    def tokens(self) -> list[dict]:
        return self._request(
            "GET",
            "user_canvas_tokens",
            params={
                "select": "user_id,ciphertext,state,last_run_at,summary_time",
                "disabled_at": "is.null",
                "order": "last_run_at.asc.nullsfirst",
                "limit": str(MAX_USERS_PER_RUN),
            },
        ).json()

    def update(self, user_id: str, fields: dict) -> None:
        self._request("PATCH", "user_canvas_tokens", params={"user_id": f"eq.{user_id}"}, json=fields)

    def add_alerts(self, user_id: str, alerts: list) -> None:
        if alerts:
            rows = [
                {"user_id": user_id, "title": a.title[:180], "body": a.body[:600], "url": a.url,
                 "priority": a.priority, "kind": alert_kind(a)}
                for a in alerts
            ]
            self._request("POST", "user_canvas_alerts", json=rows, headers={"Prefer": "return=minimal"})


def process_user(store, master_key: str, row: dict, now: datetime, read=read_canvas) -> str:
    """One user. Returns ok, partial, rejected or error (never raises for one user's problem)."""
    user_id = row["user_id"]
    stamp = now.isoformat()
    try:
        token = decrypt_api_key(master_key, f"{user_id}:canvas", row["ciphertext"])
    except ByokCryptoError:
        store.update(user_id, {"disabled_at": stamp, "error_at": stamp,
                               "last_error": "저장된 토큰을 읽지 못했어요. 다시 등록해 주세요."})
        return "error"
    state = state_from_row(row.get("state"))
    incomplete = [False]
    log = io.StringIO()

    def reserve() -> bool:
        nonlocal state
        state = replace(state, last_learningx_launch=stamp)
        return True

    try:
        with contextlib.redirect_stderr(log):
            items = read(token, now, reserve_learningx=reserve, on_incomplete=lambda: incomplete.__setitem__(0, True))
    except CanvasError as exc:
        if str(exc) == "토큰 거절":
            state = replace(state, problem=state.problem or {"code": "token-rejected", "notifiedProblem": False})
            alert = problem_alert(state)
            store.add_alerts(user_id, [alert] if alert else [])
            state = replace(state, problem={"code": "token-rejected", "notifiedProblem": True})
            store.update(user_id, {"disabled_at": stamp, "error_at": stamp, "last_error": REJECTED,
                                   "last_reason": "토큰 거절", "last_run_at": stamp, "state": state_to_row(state)})
            return "rejected"
        reason = safe_reason(f"아이캠퍼스 조회 실패: {exc}\n{log.getvalue()}", token)
        store.update(user_id, {"last_reason": reason, "last_run_at": stamp, "state": state_to_row(state)})
        print(f"canvas {user_id[:8]}: 실패 {reason}", flush=True)
        return "error"
    except Exception as exc:  # network and parsing errors of this one user must not stop the others
        reason = f"예상하지 못한 오류({type(exc).__name__})"
        store.update(user_id, {"last_reason": reason, "last_run_at": stamp, "state": state_to_row(state)})
        print(f"canvas {user_id[:8]}: {reason}", flush=True)
        return "error"

    alerts, next_state = plan_alerts(items, state, now, LEADS, summary_time_of(row.get("summary_time")))
    if incomplete[0]:
        alerts = [
            replace(a, title=INCOMPLETE_TITLE, body=INCOMPLETE_BODY) if a.summary_day else a
            for a in alerts
            if not a.summary_day or state.partial_summary_sent_on != a.summary_day
        ]
    if state.problem:
        next_state = replace(next_state, problem=None)
    send = state.initialized  # the first successful read only records what already exists
    queued = []
    for alert in alerts:
        next_state = mark_sent(next_state, alert, now)
        if incomplete[0] and alert.summary_day:
            next_state = replace(next_state, summary_sent_on=state.summary_sent_on, partial_summary_sent_on=alert.summary_day)
        if send:
            queued.append(alert)
    store.add_alerts(user_id, queued)
    reason = safe_reason(log.getvalue(), token) if incomplete[0] else None
    store.update(user_id, {"last_run_at": stamp, "last_ok_at": stamp, "last_reason": reason, "last_error": None,
                           "error_at": None, "state": state_to_row(next_state)})
    print(f"canvas {user_id[:8]}: 일정 {len(items)}개, 알림 {len(queued)}개"
          + (f", 일부만 확인({reason})" if incomplete[0] else ""), flush=True)
    return "partial" if incomplete[0] else "ok"


def run(store, master_key: str, now: datetime, read=read_canvas) -> dict[str, int]:
    counts = {"ok": 0, "partial": 0, "rejected": 0, "error": 0, "skipped": 0}
    for row in store.tokens():
        last = row.get("last_run_at")
        if last:
            try:
                if now - datetime.fromisoformat(last) < MIN_GAP:
                    counts["skipped"] += 1
                    continue
            except ValueError:
                pass
        counts[process_user(store, master_key, row, now, read)] += 1
    return counts


def main() -> int:
    master_key = os.environ.get("BYOK_MASTER_KEY", "")
    try:
        store = CanvasStore(os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_SECRET_KEY", ""))
        try:
            counts = run(store, master_key, datetime.now(UTC))
        finally:
            store.client.close()
    except (ValueError, StoreError):
        print("Canvas worker configuration or store error", flush=True)
        return 1
    print("Canvas worker: " + " ".join(f"{k}={v}" for k, v in counts.items()), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
