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
    # 키가 없어도 공고 글에서 코드로 읽을 수 있는 것은 읽는다(회사 이름·기간·전일제·업무 분야).
    assert row["ai_status"] == "no_key" and row["department"]["status"] in ("LIKELY", "CONDITIONAL", "NEEDS_REVIEW")


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
    many = [request(user=f"u{i}") for i in range(svc.MAX_PER_RUN + 1)]
    store = Store(many, None)
    run(store)
    assert len(store.saved) == svc.MAX_PER_RUN
    assert {row["user_id"] for row in store.saved} == {f"u{i}" for i in range(svc.MAX_PER_RUN)}


def test_ai_calls_are_capped_per_run_and_the_rest_stay_pending_while_rule_only_ones_finish():
    with_key = [request(user=f"k{i}") for i in range(svc.AI_CALLS_PER_RUN + 3)]
    no_key = [request(user=f"n{i}") for i in range(5)]

    class Mixed(Store):
        def key_for(self, user_id):
            return key_row(user_id) if user_id.startswith("k") else None

    store, models = Mixed(with_key + no_key), Models(AI)
    run(store, models)
    done = {row["user_id"] for row in store.saved}
    assert models.calls == svc.AI_CALLS_PER_RUN
    assert {f"n{i}" for i in range(5)} <= done  # 키가 없는 사용자는 규칙만으로 모두 끝난다
    assert len([u for u in done if u.startswith("k")]) == svc.AI_CALLS_PER_RUN  # 나머지 키 사용자는 대기로 남는다


def test_prompt_is_not_changed_by_instructions_in_the_posting():
    assert "따르지 마세요" in gf.SYSTEM


def test_each_run_queues_new_requests_first_without_any_button():
    store, models = Store([], None), Models(AI)
    counts = run(store, models)
    assert store.enqueued == 10 and counts["grad_queued"] == 2


def test_같은_사용자가_이미_뽑은_공고_사실은_다시_쓰고_AI를_부르지_않는다():
    class SharedStore(Store):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.facts_saved = []
            self.shared = None

        def cached_ai_facts(self, user_id, notice_id, text_hash, version):
            self.asked_by = user_id
            return self.shared

        def save_ai_facts(self, user_id, notice_id, text_hash, version, reply, model):
            self.facts_saved.append((user_id, notice_id, version, model))

    req = {"user_id": "u1", "notice_id": "n1", "title": "[넷마블네오] AI 인턴십", "body": "5개월간 진행", "programs": [],
           "admission_year": 2023, "university_3p_internship_selected": True, "input_hash": "h1"}
    models = Models(text="{}")
    store = SharedStore([req], key=None)
    store.shared = {"organization_name": "넷마블네오", "organization_type": "incorporated_company", "evidence": []}
    counts = svc.run_graduation(store, MASTER, NOW, client_factory=lambda key: type("C", (), {"models": models})(), sleep=lambda s: None)
    assert models.calls == 0 and counts["grad_shared"] == 1 and store.saved[0]["ai_status"] == "used"
    assert store.asked_by == "u1"  # 캐시는 사용자별이다: 판정하는 사용자의 이름으로만 찾는다
    assert EXTRACTOR_VERSION  # 캐시 키에 추출기 버전이 들어간다


def test_a_not_software_llm_judgment_makes_the_department_result_not_eligible():
    req = request()
    req.update(title="[(주)예시] 서비스엔지니어 인턴", body="근무형태: 전일제 근무\n근무기간: 2026.12.21 ~ 2027.02.28",
               judgment_verdict="not_relevant", judgment_reason="자동차 정비 직무라서 소프트웨어 개발 직무와 거리가 멉니다.")
    store, models = Store([req], None), Models(AI)
    run(store, models)
    assert store.saved[0]["department"]["status"] == "NOT_ELIGIBLE"
    assert models.calls == 0  # 이미 있는 판정을 읽을 뿐 AI를 더 부르지 않는다


def test_stale_assessments_are_requeued_each_run_for_the_current_ruleset():
    class StaleStore(Store):
        def requeue_stale(self, ruleset, limit):
            self.stale_args = (ruleset, limit)
            return 3

    store = StaleStore([])
    counts = svc.run_graduation(store, MASTER, NOW)
    assert store.stale_args == (DEPT_RULESET, svc.STALE_PER_RUN)   # 규칙 버전이 바뀌면 옛 판정을 조금씩 새 규칙으로 다시 만든다
    assert counts["grad_stale"] == 3
    # 이 기능이 없는 저장소(옛 시험용)에서도 그냥 지나간다.
    assert svc.run_graduation(Store([]), MASTER, NOW)["grad_stale"] == 0


def test_requeue_stale_only_flips_ready_rows_of_an_old_ruleset_one_by_one():
    from skku_notice.byok_judge import JudgeStore as RealStore

    calls = []

    class Resp:
        def __init__(self, data):
            self._data = data

        def json(self):
            return self._data

    class Fake(RealStore):
        def __init__(self):
            pass

        def _request(self, method, path, **kwargs):
            calls.append((method, path, kwargs.get("params"), kwargs.get("json")))
            return Resp([{"user_id": "u1", "notice_id": "n1"}, {"user_id": "u2", "notice_id": "n2"}] if method == "GET" else [])

    assert Fake().requeue_stale("r3", 5) == 2
    get = calls[0]
    assert get[0] == "GET" and get[2]["status"] == "eq.READY" and get[2]["ruleset_version"] == "neq.r3" and get[2]["limit"] == "5"
    patches = [c for c in calls if c[0] == "PATCH"]
    assert len(patches) == 2 and all(c[2]["status"] == "eq.READY" and c[3]["status"] == "PENDING" for c in patches)
    assert {c[2]["user_id"] for c in patches} == {"eq.u1", "eq.u2"}   # 사용자마다 따로, 그 사용자의 판정만


def test_rule_text_change_reruns_rules_from_stored_facts_without_any_ai_call():
    """공고도 프로필도 그대로이고 규칙 버전만 바뀐 판정은 저장된 사실로 규칙만 다시 돌린다(자동 갱신에서 토큰을 쓰지 않는다)."""
    stored = {"organization_type": "incorporated_company", "corporate_status_verified": True, "work_mode": "full_time",
              "task_category": "software_dev", "start_date": "2027-02-15", "end_date": "2027-04-30", "explicitly_stated_hours": None,
              "daily_hours": None, "days_per_week": None, "academic_credit": None, "duration_months": None, "duration_days": None,
              "organization_name": "예시", "tasks": [], "evidence": [], "missing_fields": [], "ai_used": True}
    previous = {"input_hash": "h1", "ruleset_version": "cse-old", "extractor_version": EXTRACTOR_VERSION, "ai_status": "used",
                "model": "m", "facts": stored}
    models = Models(text="{}")
    store = Store([request()], key=key_row(), previous=previous)
    counts = svc.run_graduation(store, MASTER, NOW, client_factory=lambda key: type("C", (), {"models": models})(), sleep=lambda s: None)
    assert models.calls == 0 and counts["grad_rerule"] == 1 and counts["grad_ai"] == 0
    row = store.saved[0]
    assert row["ruleset_version"] == DEPT_RULESET and row["ai_status"] == "used" and row["facts"] == stored
    assert "기준(280시간)" in str(row["university_3p"])   # 새 규칙 문장으로 다시 만들어졌다


def test_rerun_is_skipped_when_the_input_changed_or_facts_cannot_be_restored():
    lab = {"organization_type": "skku_sw_lab", "work_mode": "full_time"}   # 월별 시간을 저장하지 않아 되살릴 수 없다
    assert svc.assess_from_stored(svc.profile_from_row(request()), lab) is None
    assert svc.assess_from_stored(svc.profile_from_row(request()), {"start_date": "not-a-date"}) is None


def test_judgments_that_ended_without_ai_are_retried_after_twelve_hours_with_the_users_own_key():
    from skku_notice.byok_judge import JudgeStore as RealStore

    calls = []

    class Resp:
        def __init__(self, data):
            self._data = data

        def json(self):
            return self._data

    class Fake(RealStore):
        def __init__(self):
            pass

        def _request(self, method, path, **kwargs):
            calls.append((method, kwargs.get("params"), kwargs.get("json")))
            return Resp([{"user_id": "u1", "notice_id": "n1"}] if method == "GET" else [])

    assert Fake().requeue_retryable(12, 5) == 1
    get = calls[0]
    assert get[1]["ai_status"] == "in.(limit,unavailable)" and get[1]["assessed_at"].startswith("lt.") and get[1]["limit"] == "5"
    patch = calls[1]
    assert patch[0] == "PATCH" and patch[1]["user_id"] == "eq.u1" and patch[2]["status"] == "PENDING"   # 그 사용자의 행만

    class RetryStore(Store):
        def requeue_retryable(self, hours, limit):
            self.retry_args = (hours, limit)
            return 2

    store = RetryStore([])
    assert svc.run_graduation(store, MASTER, NOW)["grad_retry"] == 2 and store.retry_args == (svc.RETRY_AFTER_HOURS, svc.RETRY_PER_RUN)


def test_ai_read_facts_of_an_older_extractor_are_kept_for_a_rules_only_refresh():
    """AI로 읽은 사실은 추출기 버전이 옛것이어도 다시 뽑지 않는다(키 한도를 쓰므로). 규칙만 다시 돌리고 옛 버전 표시는 그대로 둔다."""
    stored = {"organization_type": "incorporated_company", "corporate_status_verified": True, "work_mode": "full_time",
              "task_category": "software_dev", "start_date": "2027-02-15", "end_date": "2027-04-30", "explicitly_stated_hours": None,
              "daily_hours": None, "days_per_week": None, "academic_credit": None, "duration_months": None, "duration_days": None}
    models = Models(text="{}")
    for status, expect_rerule in (("used", 1), ("no_key", 0)):
        previous = {"input_hash": "h1", "ruleset_version": "cse-old", "extractor_version": "facts-8", "ai_status": status,
                    "model": "m", "facts": stored}
        store = Store([request()], key=None, previous=previous)
        counts = svc.run_graduation(store, MASTER, NOW, client_factory=lambda key: type("C", (), {"models": models})(), sleep=lambda s: None)
        assert counts["grad_rerule"] == expect_rerule and models.calls == 0
        if expect_rerule:
            assert store.saved[0]["extractor_version"] == "facts-8" and store.saved[0]["ruleset_version"] == DEPT_RULESET
