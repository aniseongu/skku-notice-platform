"""Judge external internship postings with each user's own Gemini key (BYOK), like the original service.

Only users who registered a key are processed, never with anyone else's key.
One batch of at most six postings per user per run, a daily cap per user, and errors
are recorded on the key row without any secret material.
"""

import os
import re
from datetime import UTC, datetime

from skku_notice.byok_crypto import ByokCryptoError, decrypt_api_key
from skku_notice.gemini_client import gemini_client
from skku_notice.intern_ai import BATCH, judge_internships
from skku_notice.scheduled_collection import NoticeStore, StoreError
from skku_notice.school_ai import judge_school_notices

DAILY_CALLS = 60
MAX_USERS_PER_RUN = 20
# 원본은 학년·학기·재학 상태·병역 5개만 Gemini에 보냈다.
# 사용자가 직접 적은 관심 분야 설명도 보내되 길이와 문자를 제한한다.
PROFILE_COLUMNS = (
    "programs", "year", "semester", "enrolled_semester", "enrollment_status", "military_service",
    "interests", "wants", "avoids",
)
PROFILE_TEXT_LIMIT = 300
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def _clean_text(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(_CONTROL.sub("", value).split())[:PROFILE_TEXT_LIMIT]


def build_judge_profile(row: dict) -> dict:
    """Gemini에 보낼 프로필. 이름·학번·연락처는 이 표에 없고, 주관식은 데이터로만 전달한다."""
    profile: dict = {}
    majors = []
    for program in row.get("programs") or []:
        if isinstance(program, dict) and isinstance(program.get("college"), str):
            department = program.get("department")
            college = program["college"]
            label = f"{department} ({college})" if isinstance(department, str) else college
            majors.append(_clean_text(label))
    if majors:
        profile["majors"] = majors[:4]  # 첫 항목이 주전공, 나머지가 복수전공
    for key in ("year", "semester", "enrolled_semester", "enrollment_status", "military_service"):
        if row.get(key) is not None:
            profile[key] = row[key]
    for key, name in (("interests", "interests"), ("wants", "wants"), ("avoids", "does_not_want")):
        text = _clean_text(row.get(key))
        if text:
            profile[name] = text
    return profile
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
        params = {"user_id": f"eq.{user_id}", "select": ",".join(PROFILE_COLUMNS)}
        rows = self._request("GET", "user_profiles", params=params).json()
        return build_judge_profile(rows[0] if rows else {})

    def pending(self, user_id: str) -> list[dict]:
        body = {"p_user_id": user_id, "p_limit": BATCH}
        return self._request("POST", "rpc/list_byok_pending", json=body).json()

    def pending_school(self, user_id: str) -> list[dict]:
        body = {"p_user_id": user_id, "p_limit": BATCH}
        return self._request("POST", "rpc/list_byok_pending_school", json=body).json()

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
        school = store.pending_school(user_id)
        if not pending and not school:
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
        profile = store.profile(user_id)
        phases = (
            (pending, judge_internships),
            (school, judge_school_notices),
        )
        for batch, judge in phases:
            if not batch or used >= DAILY_CALLS:
                continue
            items = [{"id": p["notice_id"], "title": p["title"], "body": p["body"]} for p in batch]
            found = judge(items, row["model"], api_key, profile=profile, client=client)
            used += 1
            usage = {"used_on": today, "used_today": used}
            if client.failed and client.error_code in REJECTED_CODES:
                stamp = now.isoformat()
                store.update_key(
                    user_id,
                    {**usage, "disabled_at": stamp, "error_at": stamp,
                     "last_error": "Gemini가 이 키를 받아 주지 않아요. 키를 다시 등록해 주세요."},
                )
                counts["rejected"] += 1
                break
            if client.failed:
                message = (
                    "Gemini 사용 한도를 넘었어요. 잠시 뒤 다시 시도해요."
                    if client.error_code == 429
                    else "Gemini 판정을 잠시 못 했어요. 다시 시도해요."
                )
                store.update_key(user_id, {**usage, "last_error": message, "error_at": now.isoformat()})
                counts["errors"] += 1
                break
            store.save_judgments(
                [
                    {
                        "user_id": user_id,
                        "notice_id": key,
                        "verdict": j.verdict,
                        "reason": j.reason[:300],
                        "model": j.model,
                        "summary": j.summary,
                        "deadline": j.deadline,
                        "deadline_kind": j.deadline_kind,
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
