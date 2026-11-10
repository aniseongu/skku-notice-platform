"""Judge external internship postings with each user's own Gemini key (BYOK), like the original service.

Only users who registered a key are processed, never with anyone else's key.
One batch of at most six postings per user per run, a daily cap per user, and errors
are recorded on the key row without any secret material.
"""

import os
import re
import time
from datetime import UTC, datetime

from skku_notice.byok_crypto import ByokCryptoError, decrypt_api_key
from skku_notice.gemini_client import gemini_client
from skku_notice.intern_ai import BATCH, judge_internships
from skku_notice.scheduled_collection import NoticeStore, StoreError
from skku_notice.school_ai import judge_school_notices
from skku_notice.translate import translate_notice

DAILY_CALLS = 60
MAX_USERS_PER_RUN = 20
# 새 키 사용자의 밀린 공지를 빨리 채우려고, 한 실행에서 사용자당 같은 종류를 최대 이만큼 이어서 판정한다.
# 무료 Gemini 분당 한도를 넘지 않게 호출 사이에 쉬고, 서비스 제한 420초 안에 끝나도록 시간 예산을 둔다.
ROUNDS_PER_PHASE = 4
PACE_SECONDS = 5.0
RUN_BUDGET_SECONDS = 330.0
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

    def enqueue_graduation(self, limit: int) -> int:
        response = self._request("POST", "rpc/enqueue_graduation_assessments", json={"p_limit": limit})
        total = int(response.json() or 0)
        try:  # 판정 뒤에 요약이 생긴 글을 다시 판정한다(함수가 아직 없으면 건너뛴다)
            again = self._request("POST", "rpc/requeue_graduation_after_summary", json={"p_limit": 3})
            total += int(again.json() or 0)
        except StoreError:
            pass
        return total

    def graduation_requests(self, limit: int) -> list[dict]:
        return self._request("POST", "rpc/list_graduation_requests", json={"p_limit": limit}).json()

    def key_for(self, user_id: str) -> dict | None:
        rows = self._request("GET", "user_byok_keys", params={
            "user_id": f"eq.{user_id}", "select": "ciphertext,model,disabled_at,used_on,used_today"}).json()
        return rows[0] if rows else None

    def assessment(self, user_id: str, notice_id: str) -> dict | None:
        rows = self._request("GET", "user_notice_graduation_assessments", params={
            "user_id": f"eq.{user_id}", "notice_id": f"eq.{notice_id}",
            "select": "input_hash,ruleset_version,extractor_version,ai_status"}).json()
        return rows[0] if rows else None

    def save_assessment(self, row: dict) -> None:
        self._request(
            "POST", "user_notice_graduation_assessments", params={"on_conflict": "user_id,notice_id"},
            json=[row], headers={"Prefer": "resolution=merge-duplicates,return=minimal"})

    def pending(self, user_id: str) -> list[dict]:
        body = {"p_user_id": user_id, "p_limit": BATCH}
        return self._request("POST", "rpc/list_byok_pending", json=body).json()

    def pending_school(self, user_id: str) -> list[dict]:
        body = {"p_user_id": user_id, "p_limit": BATCH}
        return self._request("POST", "rpc/list_byok_pending_school", json=body).json()

    def pending_translation(self, user_id: str) -> list[dict]:
        return self._request(
            "POST", "rpc/list_byok_pending_translation", json={"p_user_id": user_id, "p_limit": 3}
        ).json()

    def save_translation(self, row: dict) -> None:
        self._request("POST", "user_notice_translations", params={"on_conflict": "user_id,notice_id"},
                      json=[row], headers={"Prefer": "resolution=merge-duplicates,return=minimal"})

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


# 고른 모델이 과부하(500·503·504)일 때만 차례로 시도하는 대체 모델. 키 거부는 대체하지 않는다.
FALLBACK_MODELS = ("gemini-3.5-flash-lite", "gemini-2.5-flash-lite")
OVERLOADED = {500, 503, 504}


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
            code = getattr(exc, "code", None)
            if code in OVERLOADED:
                for model in FALLBACK_MODELS:
                    if model == kwargs.get("model"):
                        continue
                    try:
                        return self._inner.models.generate_content(**{**kwargs, "model": model})
                    except Exception:  # noqa: BLE001 - 대체 모델도 안 되면 처음 오류를 낸다
                        continue
            self.failed = True
            self.error_code = code if isinstance(code, int) else None
            raise


def run_judging(
    store: JudgeStore, master_key: str, now: datetime, client_factory=gemini_client,
    sleep=time.sleep, clock=time.monotonic,
) -> dict[str, int]:
    counts = {"users": 0, "judged": 0, "translated": 0, "translation_failed": 0,
              "rejected": 0, "limited": 0, "errors": 0}
    today = now.astimezone(UTC).date().isoformat()
    started = clock()
    for row in store.keys():
        if clock() - started > RUN_BUDGET_SECONDS:
            break
        user_id = row["user_id"]
        used = row["used_today"] if row.get("used_on") == today else 0
        if used >= DAILY_CALLS:
            counts["limited"] += 1
            continue
        pending = store.pending(user_id)
        school = store.pending_school(user_id)
        translations = store.pending_translation(user_id)
        if not pending and not school and not translations:
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
            (pending, judge_internships, store.pending),
            (school, judge_school_notices, store.pending_school),
        )
        calls = 0
        for first_batch, judge, refill in phases:
            batch = first_batch
            for round_no in range(ROUNDS_PER_PHASE):
                if round_no:
                    if clock() - started > RUN_BUDGET_SECONDS:
                        break
                    batch = refill(user_id)
                if not batch or used >= DAILY_CALLS:
                    break
                if calls:
                    sleep(PACE_SECONDS)
                calls += 1
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
                            "deadline_checked": judge is judge_school_notices,
                        }
                        for key, j in found.items()
                    ]
                )
                store.update_key(user_id, {**usage, "last_error": None, "error_at": None})
                counts["judged"] += len(found)
                # 가득 차지 않았거나 하나도 못 받았으면 더 이을 것이 없다.
                if len(batch) < BATCH or not found:
                    break
            if client.failed:
                break
        if client.failed:
            continue
        for item in translations:
            if used >= DAILY_CALLS:
                break
            translated = translate_notice(
                item["title"], item.get("body"), row["model"], api_key, client=client
            )
            used += 1
            usage = {"used_on": today, "used_today": used}
            if client.failed:
                fields = {**usage, "last_error": "Gemini 번역을 잠시 못 했어요. 다시 시도해요.",
                          "error_at": now.isoformat()}
                if client.error_code in REJECTED_CODES:
                    fields["disabled_at"] = now.isoformat()
                    fields["last_error"] = "Gemini가 이 키를 받아 주지 않아요. 키를 다시 등록해 주세요."
                store.update_key(user_id, fields)
                counts["errors"] += 1
                break
            store.save_translation({"user_id": user_id, "notice_id": item["notice_id"],
                                    "title": translated[0] if translated else None,
                                    "body": translated[1] if translated else None, "model": row["model"],
                                    "attempts": item["attempts"] + 1, "updated_at": now.isoformat()})
            counts["translated" if translated else "translation_failed"] += 1
            store.update_key(user_id, {**usage, "last_error": None, "error_at": None})
    return counts


def main() -> int:
    master_key = os.environ.get("BYOK_MASTER_KEY", "")
    try:
        store = JudgeStore(os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_SECRET_KEY", ""))
        try:
            counts = run_judging(store, master_key, datetime.now(UTC))
            from skku_notice.grad_intern_service import run_graduation

            try:
                counts.update(run_graduation(store, master_key, datetime.now(UTC)))
            except StoreError:
                # 졸업요건 표가 아직 없는 환경이어도 기존 판정 결과와 종료 코드는 그대로 둔다.
                print("졸업요건 요청 처리를 건너뛰었어요", flush=True)
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
