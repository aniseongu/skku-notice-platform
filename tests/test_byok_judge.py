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
    def __init__(self, rows, pending=ITEMS, profile=None):
        self.rows, self._pending, self._profile = rows, pending, profile or {"year": 3}
        self.saved, self.updates, self.pending_calls = [], [], []

    def keys(self):
        return self.rows

    def pending(self, user_id):
        self.pending_calls.append(user_id)
        return self._pending

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
         "reason": "서버 개발 직무예요", "model": "gemini-3.1-flash-lite"}
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
