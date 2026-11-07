from datetime import UTC, datetime

import pytest

from skku_notice import byok_judge as judge
from skku_notice.byok_crypto import b64encode, encrypt_api_key

MASTER = b64encode(b"k" * 32)
NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
GOOD = "AIza" + "G" * 35
ITEMS = [{"notice_id": "ext/1", "title": "[회사] 개발 인턴", "body": "서버 개발"}]


def key_row(user, secret=GOOD, used_today=0, used_on="2026-11-07"):
    return {
        "user_id": user,
        "ciphertext": encrypt_api_key(MASTER, user, secret, b"i" * 12),
        "model": "gemini-3.1-flash-lite",
        "used_on": used_on,
        "used_today": used_today,
    }


class FakeStore:
    def __init__(self, rows, pending=ITEMS, profile=None, school=()):
        self.rows, self._pending, self._profile = rows, pending, profile or {"year": 3}
        self._school = list(school)
        self.saved, self.updates, self.pending_calls = [], [], []

    def keys(self):
        return self.rows

    def pending(self, user_id):
        self.pending_calls.append(user_id)
        return self._pending

    def pending_school(self, user_id):
        return self._school

    def profile(self, user_id):
        return self._profile

    def save_judgments(self, rows):
        self.saved.extend(rows)

    def update_key(self, user_id, fields):
        self.updates.append((user_id, fields))


class FakeModels:
    def __init__(self, outcome):
        self.outcome, self.calls = outcome, []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


class FakeClient:
    def __init__(self, outcome):
        self.models = FakeModels(outcome)


class Reply:
    def __init__(self, text):
        self.text = text


class ApiError(Exception):
    def __init__(self, code):
        super().__init__(f"HTTP {code}")
        self.code = code


def factory(outcome, keys_seen=None):
    def make(api_key):
        if keys_seen is not None:
            keys_seen.append(api_key)
        return FakeClient(outcome)

    return make


def test_judges_with_the_users_own_key_and_saves_per_user_results():
    seen = []
    reply = Reply('{"items": [{"id": "ext/1", "verdict": "relevant", "reason": "서버 개발 직무예요"}]}')
    store = FakeStore([key_row("user-a")])
    counts = judge.run_judging(store, MASTER, NOW, factory(reply, seen))
    assert seen == [GOOD]
    assert counts["judged"] == 1
    assert store.saved == [
        {"user_id": "user-a", "notice_id": "ext/1", "verdict": "relevant",
         "reason": "서버 개발 직무예요", "model": "gemini-3.1-flash-lite", "summary": None}
    ]
    cleared = {"used_on": "2026-11-07", "used_today": 1, "last_error": None, "error_at": None}
    assert store.updates[-1][1] == cleared


def test_a_key_is_never_used_for_another_user():
    other = key_row("user-b")
    other["ciphertext"] = key_row("user-a")["ciphertext"]  # moved to another user's row
    store = FakeStore([other])
    seen = []
    counts = judge.run_judging(store, MASTER, NOW, factory(Reply("{}"), seen))
    assert seen == []
    assert counts["errors"] == 1
    assert store.updates[0][0] == "user-b" and store.updates[0][1]["disabled_at"]
    assert GOOD not in str(store.updates)


@pytest.mark.parametrize("code", [400, 401, 403])
def test_rejected_key_is_disabled_with_a_plain_message(code):
    store = FakeStore([key_row("user-a")])
    counts = judge.run_judging(store, MASTER, NOW, factory(ApiError(code)))
    assert counts["rejected"] == 1 and store.saved == []
    fields = store.updates[-1][1]
    assert fields["disabled_at"] and "다시 등록" in fields["last_error"] and GOOD not in str(fields)


def test_rate_limit_and_transient_errors_keep_the_key_enabled():
    for code, text in ((429, "한도"), (500, "다시 시도")):
        store = FakeStore([key_row("user-a")])
        counts = judge.run_judging(store, MASTER, NOW, factory(ApiError(code)))
        assert counts["errors"] == 1 and store.saved == []
        fields = store.updates[-1][1]
        assert "disabled_at" not in fields and text in fields["last_error"] and fields["used_today"] == 1


def test_daily_cap_resets_each_day_and_skips_users_without_pending_postings():
    capped = FakeStore([key_row("user-a", used_today=judge.DAILY_CALLS)])
    assert judge.run_judging(capped, MASTER, NOW, factory(Reply("{}")))["limited"] == 1
    assert capped.pending_calls == []
    yesterday = FakeStore([key_row("user-a", used_today=judge.DAILY_CALLS, used_on="2026-11-06")], pending=[])
    counts = judge.run_judging(yesterday, MASTER, NOW, factory(Reply("{}")))
    assert counts["limited"] == 0 and yesterday.pending_calls == ["user-a"] and yesterday.updates == []


def test_profile_reaches_gemini_and_other_users_are_processed_independently():
    reply = Reply('{"items": [{"id": "ext/1", "verdict": "not_relevant", "reason": "비개발 직무예요"}]}')
    store = FakeStore([key_row("user-a"), key_row("user-b")])
    counts = judge.run_judging(store, MASTER, NOW, factory(reply))
    assert counts["judged"] == 2 and {r["user_id"] for r in store.saved} == {"user-a", "user-b"}


def test_judge_profile_carries_majors_and_the_users_own_words_but_nothing_else():
    row = {
        "programs": [
            {"college": "소프트웨어융합대학", "department": "소프트웨어학과"},
            {"college": "경영대학", "department": "경영학과"},
            {"college": "학부대학", "department": None},
            "bad",
        ],
        "year": 3, "semester": None, "enrollment_status": "재학", "military_service": "해당 없음",
        "interests": "인공지능,\n백엔드 \x00개발", "wants": "  학부생 인턴  ", "avoids": "",
        "user_id": "secret", "email": "x@y.z",
    }
    profile = judge.build_judge_profile(row)
    assert profile["majors"] == ["소프트웨어학과 (소프트웨어융합대학)", "경영학과 (경영대학)", "학부대학"]
    assert profile["year"] == 3 and "semester" not in profile
    assert profile["interests"] == "인공지능, 백엔드 개발" and profile["wants"] == "학부생 인턴"
    assert "does_not_want" not in profile
    assert "user_id" not in profile and "email" not in profile


def test_judge_profile_text_is_capped_and_never_empty_keys():
    profile = judge.build_judge_profile({"interests": "가" * 1000, "wants": 7, "avoids": "나" * 10})
    assert len(profile["interests"]) == judge.PROFILE_TEXT_LIMIT
    assert "wants" not in profile and profile["does_not_want"] == "나" * 10
    assert judge.build_judge_profile({}) == {}


def test_store_profile_reads_the_new_columns_and_filters_through_the_builder():
    seen = {}

    class Reply:
        def json(self):
            program = {"college": "경영대학", "department": "경영학과"}
            return [{"programs": [program], "year": 2, "interests": "마케팅"}]

    class Store(judge.JudgeStore):
        def __init__(self):
            pass

        def _request(self, method, path, **kwargs):
            seen.update(kwargs["params"])
            return Reply()

    assert Store().profile("u") == {"majors": ["경영학과 (경영대학)"], "year": 2, "interests": "마케팅"}
    assert "interests" in seen["select"] and "avoids" in seen["select"] and seen["user_id"] == "eq.u"


def test_prompt_marks_the_users_free_text_as_data_not_instructions():
    from skku_notice.intern_ai import SYSTEM

    assert "interests, wants, does_not_want" in SYSTEM and "지시가 아닙니다" in SYSTEM


def test_school_notices_are_judged_with_the_same_key_and_saved_like_internships():
    school = [{"notice_id": "sw/1", "title": "졸업요건 안내", "body": "소프트웨어학과 재학생 대상"}]
    reply = Reply(
        '{"items": [{"id": "sw/1", "verdict": "relevant", "reason": "소프트웨어학과 재학생이 대상이에요", '
        '"summary": "소프트웨어학과 재학생이 졸업요건을 확인해요.\\n12월 5일까지 제출해요."}]}'
    )
    store = FakeStore([key_row("user-a")], pending=[], school=school)
    counts = judge.run_judging(store, MASTER, NOW, factory(reply))
    assert counts["judged"] == 1
    assert store.saved == [{"user_id": "user-a", "notice_id": "sw/1", "verdict": "relevant",
                            "reason": "소프트웨어학과 재학생이 대상이에요", "model": "gemini-3.1-flash-lite",
                            "summary": "소프트웨어학과 재학생이 졸업요건을 확인해요.\n12월 5일까지 제출해요."}]
    assert store.updates[-1][1]["used_today"] == 1


def test_both_kinds_use_one_call_each_and_a_failure_stops_the_user():
    school = [{"notice_id": "sw/1", "title": "t", "body": "b"}]
    ok = Reply(
        '{"items": [{"id": "ext/1", "verdict": "relevant", "reason": "서버 개발 직무예요"}, '
        '{"id": "sw/1", "verdict": "maybe", "reason": "대상이 불분명해요"}]}'
    )
    store = FakeStore([key_row("user-a")], school=school)
    judge.run_judging(store, MASTER, NOW, factory(ok))
    assert store.updates[-1][1]["used_today"] == 2
    failing = FakeStore([key_row("user-a")], school=school)
    counts = judge.run_judging(failing, MASTER, NOW, factory(ApiError(429)))
    assert counts["errors"] == 1 and failing.saved == [] and failing.updates[-1][1]["used_today"] == 1
