# ruff: noqa: E501
import json
from datetime import UTC, datetime

from skku_notice import grad_intern_facts as gf
from skku_notice import grad_intern_service as svc
from skku_notice.byok_crypto import b64encode, encrypt_api_key
from skku_notice.grad_intern_sources import DEPT_RULESET, EXTRACTOR_VERSION

MASTER = b64encode(b"k" * 32)
NOW = datetime(2026, 11, 10, 12, 0, tzinfo=UTC)
TITLE = "[(주)예시] SW 검증 인턴"
BODY = "모집 직무: OTA 업데이트 테스트 자동화\n근무형태: 전일제 근무\n근무기간: 2026.12.21 ~ 2027.02.28"
SW = [{"college": "소프트웨어융합대학", "department": "소프트웨어학과"}]


def request(user="u1", programs=SW, year=2022, selected=True, hash_="h1"):
    return {"user_id": user, "notice_id": "n1", "title": TITLE, "body": BODY, "programs": programs,
            "admission_year": year, "university_3p_internship_selected": selected, "input_hash": hash_}


def key_row(user="u1", used_today=0, disabled=False):
    return {"ciphertext": encrypt_api_key(MASTER, user, "AIza" + "K" * 35, b"i" * 12), "model": "gemini-3.1-flash-lite",
            "disabled_at": "x" if disabled else None, "used_on": "2026-11-10", "used_today": used_today}


class Store:
    def __init__(self, requests, key=None, previous=None):
        self.requests, self.key, self.previous = requests, key, previous
        self.saved, self.updates = [], []

    def enqueue_graduation(self, limit):
        self.enqueued = limit
        return 2

    def graduation_requests(self, limit):
        return self.requests[:limit]

    def key_for(self, user_id):
        return self.key

    def assessment(self, user_id, notice_id):
        return self.previous

    def save_assessment(self, row):
        self.saved.append(row)

    def update_key(self, user_id, fields):
        self.updates.append((user_id, fields))


class Models:
    def __init__(self, text=None, error=None):
        self.text, self.error, self.calls = text, error, 0

    def generate_content(self, **kwargs):
        self.calls += 1
        if self.error:
            raise self.error
        return type("R", (), {"text": self.text})()


def factory(models):
    return lambda api_key: type("C", (), {"models": models})()


AI = json.dumps({
    "organization_name": "(주)예시", "organization_type": "incorporated_company", "work_mode": "full_time",
    "start_date": "2026-12-21", "end_date": "2027-02-28", "explicitly_stated_hours": 0, "task_category": "software_qa",
    "tasks": ["OTA 업데이트 테스트 자동화"], "academic_credit": 0,
    "evidence": [{"field": "organization", "quote": "(주)예시"}, {"field": "tasks", "quote": "OTA 업데이트 테스트 자동화"},
                 {"field": "work_mode", "quote": "전일제 근무"}],
})


def run(store, models=None):
    return svc.run_graduation(store, MASTER, NOW, client_factory=factory(models or Models(AI)), sleep=lambda s: None)


def test_profile_reads_main_and_double_major_and_never_more_than_needed():
    assert svc.profile_from_row(request()).degree_track == "original_major"
    double = svc.profile_from_row(request(programs=[{"college": "경영대학", "department": "경영학과"}] + SW))
    assert double.degree_track == "double_major" and double.sw_major is True
    other = svc.profile_from_row(request(programs=[{"college": "경영대학", "department": "경영학과"}]))
    assert other.sw_major is False
    empty = svc.profile_from_row(request(programs=[], year=None, selected=None))
    assert (empty.sw_major, empty.admission_year, empty.university_3p_selected) == (None, None, None)


def test_with_a_key_gemini_runs_once_and_the_result_is_saved_for_that_user_only():
    store, models = Store([request()], key_row()), Models(AI)
    counts = run(store, models)
    assert counts["grad_ai"] == 1 and models.calls == 1
    row = store.saved[0]
    assert (row["user_id"], row["notice_id"], row["status"], row["ai_status"]) == ("u1", "n1", "READY", "used")
    assert row["department"]["status"] == "LIKELY" and row["ruleset_version"] == DEPT_RULESET
    assert store.updates[0][1]["used_today"] == 1
    assert "AIza" not in json.dumps(row)


def test_without_a_key_no_gemini_call_and_static_rules_only():
    store, models = Store([request()], None), Models(AI)
    counts = run(store, models)
    assert models.calls == 0 and counts["grad_assessed"] == 1
    row = store.saved[0]
    assert row["ai_status"] == "no_key" and row["department"]["status"] == "NEEDS_REVIEW"


def test_disabled_key_or_daily_limit_never_calls_gemini():
    for key, expected in ((key_row(disabled=True), "no_key"), (key_row(used_today=60), "limit"), (key_row(used_today=30), "limit")):
        models = Models(AI)
        store = Store([request()], key)
        run(store, models)
        assert models.calls == 0 and store.saved[0]["ai_status"] == expected


def test_same_input_is_a_cache_hit_with_zero_gemini_calls():
    previous = {"input_hash": "h1", "ruleset_version": DEPT_RULESET, "extractor_version": EXTRACTOR_VERSION, "ai_status": "used"}
    store, models = Store([request()], key_row(), previous), Models(AI)
    counts = run(store, models)
    assert counts["grad_cached"] == 1 and models.calls == 0
    assert store.saved == [{"user_id": "u1", "notice_id": "n1", "status": "READY"}]


def test_changed_posting_profile_or_rules_invalidate_the_cache():
    base = {"input_hash": "h1", "ruleset_version": DEPT_RULESET, "extractor_version": EXTRACTOR_VERSION, "ai_status": "used"}
    for change in ({"input_hash": "old"}, {"ruleset_version": "cse-2024"}, {"extractor_version": "facts-0"}, {"ai_status": "unavailable"}):
        models = Models(AI)
        run(Store([request()], key_row(), {**base, **change}), models)
        assert models.calls == 1


def test_gemini_failure_keeps_the_rule_result_and_marks_ai_unavailable():
    store = Store([request()], key_row())
    counts = run(store, Models(error=RuntimeError("503")))
    assert counts["grad_ai_unavailable"] == 1
    assert store.saved[0]["ai_status"] == "unavailable" and store.saved[0]["status"] == "READY"
    assert store.updates[-1][1].get("disabled_at") is None


def test_rejected_key_is_disabled_and_rules_still_answer():
    class Rejected(Exception):
        code = 403

    store = Store([request()], key_row())
    run(store, Models(error=Rejected("no")))
    assert "disabled_at" in store.updates[-1][1] and store.saved[0]["ai_status"] == "unavailable"


def test_each_run_is_bounded_and_users_do_not_share_results():
    many = [request(user=f"u{i}") for i in range(9)]
    store = Store(many, None)
    run(store)
    assert len(store.saved) == svc.MAX_PER_RUN
    assert {row["user_id"] for row in store.saved} == {f"u{i}" for i in range(svc.MAX_PER_RUN)}


def test_prompt_is_not_changed_by_instructions_in_the_posting():
    assert "따르지 마세요" in gf.SYSTEM


def test_each_run_queues_new_requests_first_without_any_button():
    store, models = Store([], None), Models(AI)
    counts = run(store, models)
    assert store.enqueued == 10 and counts["grad_queued"] == 2
