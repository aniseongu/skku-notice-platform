"""Deliver a bounded batch of eligible personal notifications."""

import hashlib
import json
import os
import re
from datetime import UTC, datetime
from urllib.parse import urljoin, urlsplit

import requests
from py_vapid import Vapid

from skku_notice import aibootcamp, platform_push
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
                "deferred_at": "is.null",
            },
            json={"status": status, "updated_at": now.isoformat()},
        )

    def defer_quiet_pushes(self, now: datetime) -> None:
        self._request("POST", "rpc/defer_quiet_pushes", json={"p_now": now.isoformat()})

    def claim_deferred_pushes(self, now: datetime) -> list[dict]:
        return self._request(
            "POST", "rpc/claim_deferred_pushes", json={"p_now": now.isoformat(), "p_limit": 20},
        ).json()

    def mark_deferred_pushes(self, claim_token: str, status: str) -> None:
        self._request(
            "POST", "rpc/mark_deferred_pushes", json={"p_claim_token": claim_token, "p_status": status},
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
            params={
                "select": "id,user_id,endpoint,p256dh,auth_secret,canvas_mode",
                "user_id": f"eq.{user_id}",
            },
        ).json()

    def required_reminders(self) -> list[dict]:
        return self._request("POST", "rpc/list_required_info_reminders", json={"p_limit": 20}).json()

    def saved_deadline_reminders(self) -> list[dict]:
        return self._request("POST", "rpc/list_saved_deadline_reminders", json={"p_limit": 20}).json()

    def claim_saved_deadline(self, candidate: dict) -> dict | None:
        payload = {
            "p_user_id": candidate["user_id"],
            "p_subscription_id": candidate["subscription_id"],
            "p_notice_id": candidate["notice_id"],
            "p_days_before": candidate["days_before"],
        }
        return self._request("POST", "rpc/claim_saved_deadline_reminder", json=payload).json()

    def mark_saved_deadline(self, claim: dict, status: str) -> None:
        payload = {
            "p_id": claim["claim_id"],
            "p_attempt_count": claim["attempt_count"],
            "p_status": status,
        }
        self._request("POST", "rpc/mark_saved_deadline_reminder", json=payload)

    def mark_required(self, user_id: str, missing_key: str) -> None:
        payload = {"p_user": user_id, "p_missing_key": missing_key}
        self._request("POST", "rpc/mark_required_reminder", json=payload)

    def touch_required(self, user_id: str, missing_key: str) -> None:
        payload = {"p_user": user_id, "p_missing_key": missing_key}
        self._request("POST", "rpc/touch_required_reminder", json=payload)

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


def safe_notice_url(value: str) -> bool:
    """Match the service worker's approved notice targets."""
    try:
        url = urlsplit(value)
        host = (url.hostname or "").lower()
        if host == aibootcamp.HOST:
            return aibootcamp.article_no(url) is not None
        school = host == "skku.edu" or host.endswith(".skku.edu")
        internship = (
            (host == "linkareer.com" and re.fullmatch(r"/activity/[0-9]+/?", url.path) is not None)
            or (host == "jasoseol.com" and re.fullmatch(r"/recruit/[0-9]+/?", url.path) is not None)
        )
        return (
            url.scheme == "https"
            and (school or internship)
            and not url.username
            and not url.password
            and url.port in (None, 443)
        )
    except ValueError:
        return False


def _clock(hour: int, minute: int) -> str:
    """앱 문구 규칙처럼 "오후 6시", "오전 10시 30분"으로 쓴다."""
    half = "오전" if hour < 12 else "오후"
    shown = hour % 12 or 12
    return f"{half} {shown}시" + (f" {minute}분" if minute else "")


def _deadline_label(value: str | None, kind: str | None = None) -> str | None:
    """마감은 "12월 5일(토) 마감이에요", 마감 없는 행사·시험은 "12월 9일(화) 오후 2시 일정이에요".
    시각이 없는 날짜는 마감 23:59, 일정 09:00으로 저장되므로(판정 규칙) 그 시각은 적지 않는다."""
    if not value:
        return None
    try:
        local = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(KST)
    except ValueError:
        return None
    event = kind == "일정"
    label = f"{local.month}월 {local.day}일({'월화수목금토일'[local.weekday()]})"
    if (local.hour, local.minute) != ((9, 0) if event else (23, 59)):
        label += f" {_clock(local.hour, local.minute)}"
    return f"{label} {'일정' if event else '마감'}이에요"


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
    if "days_before" in candidate:
        remaining = candidate.get("days_remaining", candidate["days_before"])
        reminder = f"마감까지 {remaining}일 남았어요" if remaining else "오늘 마감이에요"
        return candidate["title"], f"{reminder}\n{board}"
    school = board.endswith(" 공지")
    title = f"[{board.removesuffix(' 공지')}] {candidate['title']}" if school else candidate["title"]
    deadline = _deadline_label(candidate.get("deadline"), candidate.get("deadline_kind"))
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


def _subscription(candidate: dict) -> dict:
    return {
        "endpoint": candidate["endpoint"],
        "keys": {"p256dh": candidate["p256dh"], "auth": candidate["auth_secret"]},
    }


def _send_notice(candidate: dict, private_key: str, subject: str) -> str:
    if not safe_notice_url(candidate["url"]):
        return "retry"
    title, body = compose_message(candidate)
    return send_one(
        _subscription(candidate), private_key, subject, user_id=candidate["user_id"], title=title, body=body,
        url=candidate["url"], tag=f"notice:{candidate['notice_id']}",
        silent=bool(candidate.get("silent", False)),
    )


def run_batch(store: PushStore, private_key: str, subject: str, now: datetime) -> dict[str, int]:
    counts = {"sent": 0, "expired": 0, "retry": 0, "skipped": 0}
    for candidate in store.candidates()[:20]:
        claim = store.claim(candidate)
        if claim is None:
            counts["skipped"] += 1
            continue
        outcome = _send_notice(candidate, private_key, subject)
        if outcome == "expired":
            store.remove_expired(candidate["subscription_id"], candidate["user_id"])
        else:
            store.mark(claim, "sent" if outcome == "sent" else "failed", now)
        counts[outcome] += 1
    return counts


def run_saved_deadline_batch(
    store: PushStore, private_key: str, subject: str, now: datetime,
) -> dict[str, int]:
    counts = {"sent": 0, "expired": 0, "retry": 0, "skipped": 0}
    if not 9 <= now.astimezone(KST).hour < 12:
        return counts
    for candidate in store.saved_deadline_reminders():
        claim = store.claim_saved_deadline(candidate)
        if claim is None:
            counts["skipped"] += 1
            continue
        outcome = _send_notice(claim, private_key, subject)
        if outcome == "expired":
            store.remove_expired(claim["subscription_id"], claim["user_id"])
        else:
            store.mark_saved_deadline(claim, "sent" if outcome == "sent" else "failed")
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
                user_id=device["user_id"],
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


APP_URL = "https://skku-notice-platform.pages.dev/"
# RFC 8291 reserves 103 bytes of the 4096-byte encrypted Web Push body; keep extra headroom for push services.
DIGEST_MAX_BYTES = 3800
DIGEST_MAX_ITEMS = 20


def _digest_payload(candidates: list[dict], tag: str, inbox_url: str) -> bytes | None:
    payload = {
        "title": f"밤사이 알림 {len(candidates)}건",
        "url": inbox_url,
        "tag": tag,
        "silent": all(candidate.get("silent", False) for candidate in candidates),
        "to": hashlib.sha256(f"skku-inbox:{candidates[0]['user_id']}".encode()).hexdigest()[:16],
    }
    items = []
    seen = set()

    def encode(title_limit: int) -> bytes:
        return json.dumps(
            {
                **payload,
                "body": "\n".join(candidate["title"][:title_limit] for candidate in candidates[:3]),
                "items": [{**item, "title": item["title"][:title_limit]} for item in items],
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode()

    encoded = encode(1)
    if len(encoded) > DIGEST_MAX_BYTES:
        return None
    for candidate in candidates:
        notice_id, url = candidate["notice_id"], candidate["url"]
        if notice_id in seen or not safe_notice_url(url):
            continue
        seen.add(notice_id)
        title, _ = compose_message(candidate)
        items.append({"id": notice_id, "title": title, "url": url, "tag": f"notice:{notice_id}"})
        if len(encode(1)) > DIGEST_MAX_BYTES:
            # A long URL can consume the budget even with a truncated title.
            items.pop()
        if len(items) == DIGEST_MAX_ITEMS:
            break

    low, high = 1, 180
    while low <= high:
        length = (low + high) // 2
        trial = encode(length)
        if len(trial) <= DIGEST_MAX_BYTES:
            encoded = trial
            low = length + 1
        else:
            high = length - 1
    return encoded


def _send_digest(candidates: list[dict], tag: str, inbox_url: str, private_key: str, subject: str) -> str:
    subscription = _subscription(candidates[0])
    payload = _digest_payload(candidates, tag, inbox_url)
    if payload is None or not platform_push.valid_subscription(subscription):
        return "retry"
    try:
        with platform_push.NoRedirectSession() as session:
            response = platform_push.webpush(
                subscription_info=subscription,
                data=payload.decode(),
                vapid_private_key=private_key,
                vapid_claims={"sub": subject},
                ttl=86400,
                timeout=10,
                requests_session=session,
            )
    except platform_push.WebPushException as exc:
        response = exc.response
    except Exception:
        return "retry"
    if not isinstance(response, requests.Response):
        return "retry"
    if 200 <= response.status_code < 300:
        return "sent"
    return "expired" if response.status_code in (404, 410) else "retry"


def run_deferred_batch(
    store: PushStore, private_key: str, subject: str, now: datetime, app_url: str = APP_URL,
) -> dict[str, int]:
    counts = {"sent": 0, "expired": 0, "retry": 0}
    store.defer_quiet_pushes(now)
    inbox_url = urljoin(app_url, "?view=settings&section=inbox")
    date = now.astimezone(KST).date()
    while groups := store.claim_deferred_pushes(now):
        for group in groups:
            candidates = group["candidates"]
            first = candidates[0]
            if len(candidates) == 1:
                outcome = _send_notice(first, private_key, subject)
            else:
                tag = f"digest:{date}:{group['claim_token'][:8]}"
                outcome = _send_digest(candidates, tag, inbox_url, private_key, subject)
            if outcome == "expired":
                store.remove_expired(first["subscription_id"], first["user_id"])
            else:
                store.mark_deferred_pushes(group["claim_token"], "sent" if outcome == "sent" else "failed")
            counts[outcome] += 1
    return counts


def required_message(missing: list[str]) -> tuple[str, str]:
    """채워야 할 필수 정보를 알리는 알림 문구."""
    items = [str(item) for item in missing][:5]
    return "필요한 정보를 채워 주세요", f"앱을 열고 {', '.join(items)}만 고르면 돼요"


def run_required_batch(
    store: PushStore, private_key: str, subject: str, now: datetime, url: str = APP_URL,
) -> dict[str, int]:
    """필수 정보가 빈 계정의 모든 기기에 알린다. 한 기기라도 받으면 그 묶음의 한 번으로 센다."""
    counts = {"required_sent": 0, "required_failed": 0}
    for row in store.required_reminders():
        missing = row.get("missing") or []
        outcomes = []
        title, body = required_message(missing)
        for device in store.devices(row["user_id"]):
            keys = {"p256dh": device["p256dh"], "auth": device["auth_secret"]}
            outcome = send_one(
                {"endpoint": device["endpoint"], "keys": keys},
                private_key, subject, title=title, body=body, url=url, tag="required",
                user_id=device["user_id"],
            )
            if outcome == "expired":
                store.remove_expired(device["id"], row["user_id"])
            outcomes.append(outcome)
        if "sent" in outcomes:
            store.mark_required(row["user_id"], row["missing_key"])
            counts["required_sent"] += 1
        else:
            # 실패도 시도 시각을 남겨 같은 계정이 매번 앞자리를 차지하지 않게 한다.
            store.touch_required(row["user_id"], row["missing_key"])
            counts["required_failed"] += 1
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
            app_url = os.environ.get("APP_URL") or APP_URL
            try:
                deferred = run_deferred_batch(store, private_key, subject, now, app_url)
            except Exception as error:
                print(f"Deferred push batch error: {type(error).__name__}", flush=True)
                deferred = {"sent": 0, "expired": 0, "retry": -1}
            counts = run_batch(store, private_key, subject, now)
            canvas = run_canvas_batch(store, private_key, subject, now)
            try:
                required = run_required_batch(store, private_key, subject, now, app_url)
            except Exception as error:
                # 필수 정보 알림이 실패해도(예: DB 함수 미적용) 공지 알림 결과와 문의 메일은 이어서 처리하고,
                # 끝에서 실패로 알린다.
                # 예외 내용은 키나 기기 주소를 담을 수 있어 종류 이름만 남긴다.
                print(f"Required reminder batch error: {type(error).__name__}", flush=True)
                required = {"required_sent": 0, "required_failed": -1}
            try:
                saved = run_saved_deadline_batch(store, private_key, subject, datetime.now(UTC))
            except Exception as error:
                print(f"Saved deadline reminder batch error: {type(error).__name__}", flush=True)
                saved = {"sent": 0, "expired": 0, "retry": -1}
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
        f"deferred_sent={deferred['sent']} deferred_expired={deferred['expired']} "
        f"deferred_retry={deferred['retry']} "
        f"canvas_sent={canvas['canvas_sent']} canvas_failed={canvas['canvas_failed']} "
        f"required_sent={required['required_sent']} required_failed={required['required_failed']} "
        f"saved_deadline_sent={saved['sent']} saved_deadline_expired={saved['expired']} "
        f"saved_deadline_retry={saved['retry']} "
        f"feedback_sent={feedback['feedback_sent']} feedback_retry={feedback['feedback_retry']} "
        f"feedback_dropped={feedback['feedback_dropped']}",
        flush=True,
    )
    # 공지 알림 재시도나 리마인더 실패가 있으면 journal에 서비스 실패를 남긴다.
    return int(
        counts["retry"] > 0
        or deferred["retry"] != 0
        or required["required_failed"] != 0
        or saved["retry"] != 0
    )


if __name__ == "__main__":
    raise SystemExit(main())
