"""Judge external internship postings with each user's own Gemini key (BYOK), like the original service.

Only users who registered a key are processed, never with anyone else's key.
One batch of at most six postings per user per run, a daily cap per user, and errors
are recorded on the key row without any secret material.
"""

import os
from datetime import UTC, datetime

from skku_notice.byok_crypto import ByokCryptoError, decrypt_api_key
from skku_notice.gemini_client import gemini_client
from skku_notice.intern_ai import BATCH, judge_internships
from skku_notice.scheduled_collection import NoticeStore, StoreError

DAILY_CALLS = 30
MAX_USERS_PER_RUN = 20
PROFILE_FIELDS = ("year", "semester", "enrolled_semester", "enrollment_status", "military_service")
REJECTED_CODES = {400, 401, 403}


class JudgeStore(NoticeStore):
    def keys(self) -> list[dict]:
        return self._request(
            "GET",
            "user_byok_keys",
            params={
                "select": "user_id,ciphertext,model,used_on,used_today",
                "disabled_at": "is.null",
                "order": "user_id",
                "limit": str(MAX_USERS_PER_RUN),
            },
        ).json()

    def profile(self, user_id: str) -> dict:
        params = {"user_id": f"eq.{user_id}", "select": ",".join(PROFILE_FIELDS)}
        rows = self._request("GET", "user_profiles", params=params).json()
        return {k: v for k, v in (rows[0] if rows else {}).items() if v is not None}

    def pending(self, user_id: str) -> list[dict]:
        body = {"p_user_id": user_id, "p_limit": BATCH}
        return self._request("POST", "rpc/list_byok_pending", json=body).json()

    def save_judgments(self, rows: list[dict]) -> None:
        if rows:
            self._request(
                "POST",
                "user_notice_judgments",
                params={"on_conflict": "user_id,notice_id"},
                json=rows,
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            )

    def update_key(self, user_id: str, fields: dict) -> None:
        self._request("PATCH", "user_byok_keys", params={"user_id": f"eq.{user_id}"}, json=fields)


class _RecordingClient:
    """Wraps the Gemini client so the worker can tell a rejected key from a transient failure."""

    def __init__(self, inner):
        self.models = self
        self._inner = inner
        self.error_code: int | None = None
        self.failed = False

    def generate_content(self, **kwargs):
        try:
            return self._inner.models.generate_content(**kwargs)
        except Exception as exc:
            self.failed = True
            code = getattr(exc, "code", None)
            self.error_code = code if isinstance(code, int) else None
            raise


def run_judging(
    store: JudgeStore, master_key: str, now: datetime, client_factory=gemini_client
) -> dict[str, int]:
    counts = {"users": 0, "judged": 0, "rejected": 0, "limited": 0, "errors": 0}
    today = now.astimezone(UTC).date().isoformat()
    for row in store.keys():
        user_id = row["user_id"]
        used = row["used_today"] if row.get("used_on") == today else 0
        if used >= DAILY_CALLS:
            counts["limited"] += 1
            continue
        pending = store.pending(user_id)
        if not pending:
            continue
        counts["users"] += 1
        try:
            api_key = decrypt_api_key(master_key, user_id, row["ciphertext"])
        except ByokCryptoError:
            stamp = now.isoformat()
            unreadable = "저장된 키를 읽지 못했어요. 다시 등록해 주세요."
            store.update_key(user_id, {"disabled_at": stamp, "error_at": stamp, "last_error": unreadable})
            counts["errors"] += 1
            continue
        client = _RecordingClient(client_factory(api_key))
        items = [{"id": p["notice_id"], "title": p["title"], "body": p["body"]} for p in pending]
        profile = store.profile(user_id)
        found = judge_internships(items, row["model"], api_key, profile=profile, client=client)
        usage = {"used_on": today, "used_today": used + 1}
        if client.failed and client.error_code in REJECTED_CODES:
            stamp = now.isoformat()
            store.update_key(
                user_id,
                {**usage, "disabled_at": stamp, "error_at": stamp,
                 "last_error": "Gemini가 이 키를 받아 주지 않아요. 키를 다시 등록해 주세요."},
            )
            counts["rejected"] += 1
            continue
        if client.failed:
            message = (
                "Gemini 사용 한도를 넘었어요. 잠시 뒤 다시 시도해요."
                if client.error_code == 429
                else "Gemini 판정을 잠시 못 했어요. 다시 시도해요."
            )
            store.update_key(user_id, {**usage, "last_error": message, "error_at": now.isoformat()})
            counts["errors"] += 1
            continue
        store.save_judgments(
            [
                {
                    "user_id": user_id,
                    "notice_id": key,
                    "verdict": j.verdict,
                    "reason": j.reason[:300],
                    "model": j.model,
                }
                for key, j in found.items()
            ]
        )
        store.update_key(user_id, {**usage, "last_error": None, "error_at": None})
        counts["judged"] += len(found)
    return counts


def main() -> int:
    master_key = os.environ.get("BYOK_MASTER_KEY", "")
    try:
        store = JudgeStore(os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_SECRET_KEY", ""))
        try:
            counts = run_judging(store, master_key, datetime.now(UTC))
        finally:
            store.close()
    except (ValueError, StoreError):
        # Never include exception text: it may carry request details.
        print("BYOK worker configuration or store error", flush=True)
        return 1
    print("BYOK worker: " + " ".join(f"{k}={v}" for k, v in counts.items()), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
