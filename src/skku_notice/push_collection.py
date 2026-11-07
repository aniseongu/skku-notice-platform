"""Deliver a bounded batch of eligible personal notifications."""

import os
import re
from datetime import UTC, datetime
from urllib.parse import urlsplit

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
    label = f"마감 {local.month}월 {local.day}일({'월화수목금토일'[local.weekday()]})"
    if (local.hour, local.minute) != (23, 59):
        label += f" {local:%H:%M}"
    return label


def compose_message(candidate: dict) -> tuple[str, str]:
    """Same wording as the original service: [board] title, with interest and deadline lines."""
    changed = candidate.get("kind") == "changed"
    title = f"[{candidate.get('source_name') or candidate['notice_id'].split('/')[0]}] "
    title += f"[수정] {candidate['title']}" if changed else candidate["title"]
    lines = []
    if changed:
        what = "제목이 바뀌었어요" if candidate.get("change_kind") == "제목" else "본문이 바뀌었어요"
        lines.append(f"학교가 글을 고쳤어요. {what}")
    elif candidate.get("matched_words"):
        lines.append(f"관심 {', '.join(candidate['matched_words'])}")
    deadline = _deadline_label(candidate.get("deadline"))
    if deadline:
        lines.append(deadline)
    return title, "\n".join(lines) or "새 공지"


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


def main() -> int:
    private_key = os.environ.get("VAPID_PRIVATE_KEY", "")
    subject = os.environ.get("VAPID_SUBJECT", "")
    try:
        subject = normalize_subject(subject)
        Vapid.from_string(private_key)
        store = PushStore(os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_SECRET_KEY", ""))
        try:
            counts = run_batch(store, private_key, subject, datetime.now(UTC))
        finally:
            store.close()
    except Exception:
        # Never include exception text: third-party failures may contain keys or endpoint URLs.
        print("Push worker configuration or store error", flush=True)
        return 1
    print(
        f"Push worker: sent={counts['sent']} expired={counts['expired']} retry={counts['retry']}", flush=True
    )
    return int(counts["retry"] > 0)


if __name__ == "__main__":
    raise SystemExit(main())
