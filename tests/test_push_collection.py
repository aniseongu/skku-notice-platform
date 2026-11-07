from datetime import UTC, datetime

import pytest

from skku_notice import push_collection as worker

NOW = datetime(2026, 11, 7, tzinfo=UTC)


def candidate(subscription_id="device", url="https://www.skku.edu/notice"):
    return {
        "user_id": "user",
        "subscription_id": subscription_id,
        "notice_id": "school/1",
        "title": "공지",
        "url": url,
        "endpoint": "https://fcm.googleapis.com/fcm/send/test",
        "p256dh": "public",
        "auth_secret": "private",
    }


class MemoryStore:
    def __init__(self, candidates):
        self.items = candidates
        self.claims = []
        self.marks = []
        self.removed = []

    def candidates(self):
        return self.items

    def claim(self, item):
        self.claims.append(item["subscription_id"])
        return None if item["subscription_id"] == "already" else len(self.claims)

    def mark(self, claim_id, status, now):
        self.marks.append((claim_id, status, now))

    def remove_expired(self, subscription_id, user_id):
        self.removed.append((subscription_id, user_id))


def test_batch_claims_before_send_and_handles_results(monkeypatch):
    store = MemoryStore([candidate("already"), candidate("sent"), candidate("expired"), candidate("retry")])
    outcomes = iter(["sent", "expired", "retry"])
    monkeypatch.setattr(worker, "send_one", lambda *_args, **_kwargs: next(outcomes))
    assert worker.run_batch(store, "key", "https://example.com", NOW) == {
        "sent": 1,
        "expired": 1,
        "retry": 1,
        "skipped": 1,
    }
    assert store.marks == [(2, "sent", NOW), (4, "failed", NOW)]
    assert store.removed == [("expired", "user")]


def test_invalid_notice_url_is_not_sent_and_claim_is_bounded(monkeypatch):
    store = MemoryStore(
        [candidate("invalid", "https://evil.invalid/")] + [candidate(str(i)) for i in range(30)]
    )
    calls = []
    monkeypatch.setattr(worker, "send_one", lambda *_args, **_kwargs: calls.append(1) or "sent")
    counts = worker.run_batch(store, "key", "https://example.com", NOW)
    assert counts["retry"] == 1 and counts["sent"] == 19
    assert len(store.claims) == 20 and len(calls) == 19
    assert store.marks[0] == (1, "failed", NOW)


def test_vapid_subject_is_normalized_to_what_py_vapid_accepts():
    from py_vapid import _check_sub

    assert worker.normalize_subject("https://example.pages.dev/") == "https://example.pages.dev"
    assert worker.normalize_subject(" mailto:admin@example.com ") == "mailto:admin@example.com"
    assert _check_sub(worker.normalize_subject("https://example.pages.dev/"))
    for bad in ("", "http://example.com", "https://", "https://example.com/path", "ftp://x.y"):
        with pytest.raises(ValueError):
            worker.normalize_subject(bad)


def test_message_matches_original_wording():
    base = {"notice_id": "school/1", "title": "장학 안내", "source_name": "소프트웨어학과"}
    assert worker.compose_message(base) == ("[소프트웨어학과] 장학 안내", "새 공지")
    interested = {**base, "matched_words": ["인턴", "장학"], "deadline": "2026-11-09T14:59:00+00:00"}
    title, body = worker.compose_message(interested)
    assert title == "[소프트웨어학과] 장학 안내"
    assert body == "관심 인턴, 장학\n마감 11월 9일(월)"
    title, body = worker.compose_message(
        {**base, "kind": "changed", "change_kind": "제목", "deadline": "2026-11-09T03:30:00+00:00"}
    )
    assert title == "[소프트웨어학과] [수정] 장학 안내"
    assert body == "학교가 글을 고쳤어요. 제목이 바뀌었어요\n마감 11월 9일(월) 12:30"


def test_changed_claim_carries_kind_and_marker():
    seen = {}

    class Store(worker.PushStore):
        def __init__(self):
            pass

        def _request(self, method, path, **kwargs):
            seen.update(kwargs["json"])

            class R:
                def json(self):
                    return 1

            return R()

    Store().claim({"user_id": "u", "subscription_id": "d", "notice_id": "s/1", "kind": "changed",
                   "change_marker": "2026-11-07T00:00:00+00:00"})
    assert seen["p_kind"] == "changed" and seen["p_change_marker"] == "2026-11-07T00:00:00+00:00"
    seen.clear()
    Store().claim({"user_id": "u", "subscription_id": "d", "notice_id": "s/1"})
    assert "p_kind" not in seen


def test_external_posting_message_carries_the_judgment_reason_before_the_deadline():
    candidate = {
        "notice_id": "linkareer-intern/1",
        "title": "[회사] 백엔드 인턴",
        "source_name": "링커리어",
        "ai_reason": "서버 개발 직무예요",
        "deadline": "2026-11-09T14:59:00+00:00",
    }
    assert worker.compose_message(candidate) == (
        "[링커리어] [회사] 백엔드 인턴",
        "서버 개발 직무예요\n마감 11월 9일(월)",
    )


def test_device_canvas_mode_decides_which_alerts_a_device_gets():
    from skku_notice.push_collection import canvas_wanted

    matrix = {
        "off": {"summary": False, "deadline": False, "problem": False},
        "summary": {"summary": True, "deadline": False, "problem": True},
        "reminders": {"summary": True, "deadline": True, "problem": True},
        None: {"summary": True, "deadline": True, "problem": True},
    }
    for mode, kinds in matrix.items():
        for kind, wanted in kinds.items():
            assert canvas_wanted(mode, kind) is wanted, (mode, kind)
