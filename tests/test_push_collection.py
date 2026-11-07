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
