"""Deliver a bounded batch of eligible personal notifications."""

import os
import re
from datetime import UTC, datetime
from urllib.parse import urlsplit

import requests
from py_vapid import Vapid

from skku_notice.deadline import KST
from skku_notice.platform_push import send_one
from skku_notice.scheduled_collection import NoticeStore


class PushStore(NoticeStore):
    def candidates(self) -> list[dict]:
        return self._request("POST", "rpc/list_notice_push_candidates", json={"p_limit": 20}).json()

    def claim(self, candidate: dict) -> int | None:
        payload = {
            "p_user_id": candidate["user_id"],
            "p_subscription_id": candidate["subscription_id"],
            "p_notice_id": candidate["notice_id"],
        }
        if candidate.get("kind") == "changed":
            payload.update({"p_kind": "changed", "p_change_marker": candidate["change_marker"]})
        return self._request("POST", "rpc/claim_notice_push", json=payload).json()

    def mark(self, claim_id: int, status: str, now: datetime) -> None:
        self._request(
            "PATCH",
            "user_notification_history",
            params={
                "id": f"eq.{claim_id}",
                "status": "eq.pending",
            },
            json={"status": status, "updated_at": now.isoformat()},
        )

    def canvas_alerts(self) -> list[dict]:
        return self._request(
            "GET",
            "user_canvas_alerts",
            params={
                "select": "id,user_id,title,body,url,priority,attempts,kind",
                "status": "in.(pending,failed)", "attempts": "lt.3", "order": "created_at.asc", "limit": "20",
            },
        ).json()

    def devices(self, user_id: str) -> list[dict]:
        return self._request(
            "GET",
            "user_push_subscriptions",
            params={"select": "id,endpoint,p256dh,auth_secret,canvas_mode", "user_id": f"eq.{user_id}"},
        ).json()

    def feedback_pending(self) -> list[dict]:
        return self._request(
            "GET",
            "user_feedback",
            params={
                "select": "id,kind,body,reply_email,created_at", "notified_at": "is.null",
                "order": "created_at.asc", "limit": "10",
            },
        ).json()

    def mark_feedback(self, feedback_id: str, now: datetime) -> None:
        self._request(
            "PATCH", "user_feedback", params={"id": f"eq.{feedback_id}", "notified_at": "is.null"},
            json={"notified_at": now.isoformat()},
        )

    def mark_canvas(self, alert_id: int, status: str, attempts: int, now: datetime) -> None:
        self._request(
            "PATCH", "user_canvas_alerts", params={"id": f"eq.{alert_id}"},
            json={"status": status, "attempts": attempts, "updated_at": now.isoformat()},
        )

    def remove_expired(self, subscription_id: str, user_id: str) -> None:
        self._request(
            "DELETE",
            "user_push_subscriptions",
            params={
                "id": f"eq.{subscription_id}",
                "user_id": f"eq.{user_id}",
            },
        )


def safe_school_url(value: str) -> bool:
    try:
        url = urlsplit(value)
        host = (url.hostname or "").lower()
        return (
            url.scheme == "https"
            and (host == "skku.edu" or host.endswith(".skku.edu"))
            and not url.username
            and not url.password
            and url.port in (None, 443)
        )
    except ValueError:
        return False


def _deadline_label(value: str | None) -> str | None:
    if not value:
        return None
    try:
        local = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(KST)
    except ValueError:
        return None
    label = f"{local.month}월 {local.day}일({'월화수목금토일'[local.weekday()]})"
    if (local.hour, local.minute) != (23, 59):
        label += f" {local:%H:%M}"
    return f"{label} 마감이에요"


def compose_message(candidate: dict) -> tuple[str, str]:
    """Notification text, reviewed against the Toss writing rules (2026-11-12, user request).

    A phone shows the title and only the first body line until the user expands it, so the AI reason
    (why this notice matters to this user) comes first in the body, then one short sentence with the
    matched keyword and the deadline ("관심 키워드 인턴, 12월 5일(토) 마감이에요").
    School board notices carry the board in the title, "[소프트웨어학과] 겨울방학 소프트웨어 인턴 모집 안내"
    (user request 2026-11-13: the board is visible even when the notification is collapsed; this is
    also the original service's "[board] title"). School board names all end in " 공지" (catalog rule),
    which is dropped. External postings already start with "[회사]", so their title stays as it is and
    the site name closes the body instead. The login screen example (web/src/login-screen.tsx) has the
    same shape. Without an AI reason (no key, AI off, or the 3-hour safety wait) the body starts with
    the keyword and deadline line.
    """
    board = candidate.get("source_name") or candidate["notice_id"].split("/")[0]
    school = board.endswith(" 공지")
    title = f"[{board.removesuffix(' 공지')}] {candidate['title']}" if school else candidate["title"]
    deadline = _deadline_label(candidate.get("deadline"))
    lines = []
    if candidate.get("kind") == "changed":
        what = "제목" if candidate.get("change_kind") == "제목" else "본문"
        lines.append(f"학교가 {what}을 고쳤어요")
        if deadline:
            lines.append(deadline)
    else:
        if candidate.get("ai_reason"):
            lines.append(candidate["ai_reason"])
        words = candidate.get("matched_words")
        keyword = f"관심 키워드 {', '.join(words)}" if words else None
        if keyword:
            lines.append(f"{keyword}, {deadline}" if deadline else keyword)
        elif deadline:
            lines.append(deadline)
    if not school:
        lines.append(board)
    return title, "\n".join(lines)


def normalize_subject(subject: str) -> str:
    """py_vapid accepts `https://host` without a path; a trailing slash makes every send fail."""
    value = subject.strip()
    if value.startswith("https://"):
        value = value.rstrip("/")
    if not re.fullmatch(r"https://[\w-]+(\.[\w-]+)+|mailto:[^@\s]+@[\w-]+(\.[\w-]+)+", value):
        raise ValueError("invalid VAPID subject")
    return value


def run_batch(store: PushStore, private_key: str, subject: str, now: datetime) -> dict[str, int]:
    counts = {"sent": 0, "expired": 0, "retry": 0, "skipped": 0}
    for candidate in store.candidates()[:20]:
        claim = store.claim(candidate)
        if claim is None:
            counts["skipped"] += 1
            continue
        if not safe_school_url(candidate["url"]):
            store.mark(claim, "failed", now)
            counts["retry"] += 1
            continue
        subscription = {
            "endpoint": candidate["endpoint"],
            "keys": {
                "p256dh": candidate["p256dh"],
                "auth": candidate["auth_secret"],
            },
        }
        title, body = compose_message(candidate)
        outcome = send_one(
            subscription,
            private_key,
            subject,
            title=title,
            body=body,
            url=candidate["url"],
            tag=f"notice:{candidate['notice_id']}",
            silent=bool(candidate.get("silent", False)),
        )
        if outcome == "expired":
            store.remove_expired(candidate["subscription_id"], candidate["user_id"])
        else:
            store.mark(claim, "sent" if outcome == "sent" else "failed", now)
        counts[outcome] += 1
    return counts


def canvas_wanted(mode: str | None, kind: str | None) -> bool:
    """Per-device iCampus mode like the original: off = nothing, summary = daily summary only,
    reminders (default) = summary and deadline reminders.
    A broken connection reaches every device that is not off."""
    mode = mode or "reminders"
    if mode == "off":
        return False
    if mode == "summary":
        return kind in {"summary", "problem"}
    return True


def run_canvas_batch(store: PushStore, private_key: str, subject: str, now: datetime) -> dict[str, int]:
    """Deliver queued iCampus alerts to the owner's own devices only."""
    counts = {"canvas_sent": 0, "canvas_failed": 0}
    for alert in store.canvas_alerts():
        outcomes = []
        for device in store.devices(alert["user_id"]):
            if not canvas_wanted(device.get("canvas_mode"), alert.get("kind")):
                continue
            keys = {"p256dh": device["p256dh"], "auth": device["auth_secret"]}
            outcome = send_one(
                {"endpoint": device["endpoint"], "keys": keys},
                private_key, subject, title=alert["title"], body=alert["body"], url=alert["url"],
                tag=f"canvas:{alert['id']}",
            )
            if outcome == "expired":
                store.remove_expired(device["id"], alert["user_id"])
            outcomes.append(outcome)
        attempts = alert["attempts"] + 1
        if not outcomes:
            # 모든 기기가 이 알림을 받지 않기로 했거나 기기가 없다. 보낼 곳이 없으니 끝난 것으로 둔다.
            store.mark_canvas(alert["id"], "sent", attempts, now)
        elif "sent" in outcomes:
            store.mark_canvas(alert["id"], "sent", attempts, now)
            counts["canvas_sent"] += 1
        else:
            store.mark_canvas(alert["id"], "failed", attempts, now)
            counts["canvas_failed"] += 1
    return counts


FEEDBACK_KIND_LABEL = {"question": "문의", "bug": "버그", "idea": "바라는 점"}
RESEND_URL = "https://api.resend.com/emails"
# 운영자 주소와 답장 메일 모두 이 모양만 받는다(DB의 user_feedback 검사와 같은 기준).
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$")


def feedback_mail(row: dict) -> dict:
    """운영자에게 보낼 메일 내용. 답장 메일을 적은 사용자라면 Reply-To로 달아 바로 답장할 수 있게 한다."""
    label = FEEDBACK_KIND_LABEL.get(row.get("kind"), "문의")
    text = str(row.get("body", "")).strip()
    first = " ".join(text.split())[:40] or "내용 없음"
    reply = str(row.get("reply_email") or "").strip()
    lines = [f"종류: {label}", f"보낸 때: {row.get('created_at', '')}", "", text, ""]
    lines.append(f"답장 메일: {reply}" if reply else "답장 메일: 적지 않았어요(답장할 수 없어요)")
    mail = {"subject": f"[성공 문의] {label}: {first}", "text": "\n".join(lines)}
    if EMAIL_RE.match(reply):
        mail["reply_to"] = reply
    return mail


def send_feedback_mail(api_key: str, sender: str, to: str, mail: dict) -> str:
    """Resend로 한 통을 보낸다. sent, retry(나중에 다시), drop(이 글은 영영 안 된다) 중 하나를 돌려준다.

    400·422처럼 글 자체 때문에 거부되면 drop이라 막힌 글 하나가 뒤의 알림을 막지 않는다.
    키 문제(401·403), 한도(429), 서버 오류와 네트워크 실패는 retry다.
    실패 사유(키, 응답 본문)는 남기지 않는다.
    """
    try:
        response = requests.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"from": sender, "to": [to], **mail},
            timeout=15,
        )
    except requests.RequestException:
        return "retry"
    if 200 <= response.status_code < 300:
        return "sent"
    return "drop" if response.status_code in (400, 422) else "retry"


def run_feedback_batch(
    store: PushStore, api_key: str, to: str, sender: str, now: datetime,
) -> dict[str, int]:
    """새 문의를 운영자 메일로 한 통씩 보낸다.

    키나 받는 주소가 없으면 읽지도 보내지도 않는다(나중에 설정하면 그때 보낸다).
    """
    counts = {"feedback_sent": 0, "feedback_retry": 0, "feedback_dropped": 0}
    if not api_key or not EMAIL_RE.match(to):
        return counts
    for row in store.feedback_pending():
        outcome = send_feedback_mail(api_key, sender, to, feedback_mail(row))
        if outcome == "retry":
            counts["feedback_retry"] += 1
            continue
        store.mark_feedback(row["id"], now)
        counts["feedback_sent" if outcome == "sent" else "feedback_dropped"] += 1
    return counts


def main() -> int:
    private_key = os.environ.get("VAPID_PRIVATE_KEY", "")
    subject = os.environ.get("VAPID_SUBJECT", "")
    try:
        subject = normalize_subject(subject)
        Vapid.from_string(private_key)
        store = PushStore(os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_SECRET_KEY", ""))
        try:
            now = datetime.now(UTC)
            counts = run_batch(store, private_key, subject, now)
            canvas = run_canvas_batch(store, private_key, subject, now)
            feedback = run_feedback_batch(
                store, os.environ.get("RESEND_API_KEY", ""), os.environ.get("FEEDBACK_NOTIFY_EMAIL", ""),
                os.environ.get("FEEDBACK_MAIL_FROM", "성공 <onboarding@resend.dev>"), now,
            )
        finally:
            store.close()
    except Exception:
        # Never include exception text: third-party failures may contain keys or endpoint URLs.
        print("Push worker configuration or store error", flush=True)
        return 1
    print(
        f"Push worker: sent={counts['sent']} expired={counts['expired']} retry={counts['retry']} "
        f"canvas_sent={canvas['canvas_sent']} canvas_failed={canvas['canvas_failed']} "
        f"feedback_sent={feedback['feedback_sent']} feedback_retry={feedback['feedback_retry']} "
        f"feedback_dropped={feedback['feedback_dropped']}",
        flush=True,
    )
    return int(counts["retry"] > 0)


if __name__ == "__main__":
    raise SystemExit(main())
