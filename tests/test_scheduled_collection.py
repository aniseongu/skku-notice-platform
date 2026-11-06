from datetime import date, datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import httpx
import pytest

from skku_notice import scheduled_collection as job
from skku_notice.fetch import FetchError
from skku_notice.model import Notice

NOW = datetime(2026, 11, 7, 3, tzinfo=ZoneInfo("Asia/Seoul"))
SOURCES = [
    {"id": "school", "name": "학교", "kind": "skku-cms", "url": "https://www.skku.edu/notice"},
    {"id": "intern", "name": "인턴", "kind": "linkareer", "external": True, "url": "https://x.test"},
]
SETTINGS = {"sources": SOURCES, "user_agent": "test", "timeout_seconds": 2}
NOTICE = Notice(
    "school",
    "123",
    "학교 공지",
    "학사",
    "https://www.skku.edu/notice?articleNo=123",
    date(2026, 11, 6),
    False,
)


class MemoryStore:
    def __init__(self):
        self.sources = {}
        self.rows = {}
        self.writes = []

    def source(self, source_id):
        return self.sources.get(source_id)

    def notices(self, source_id, article_numbers):
        return {
            key: row.copy()
            for key, row in self.rows.items()
            if key == f"{source_id}/{row['article_no']}" and row["article_no"] in article_numbers
        }

    def upsert(self, table, rows):
        self.writes.append((table, rows))
        for row in rows:
            (self.sources if table == "platform_sources" else self.rows)[row["id"]] = row.copy()


def test_collect_once_per_board_and_skip_unchanged_details(monkeypatch):
    store = MemoryStore()
    calls = []
    monkeypatch.setattr(job.time, "sleep", lambda _: None)
    monkeypatch.setattr(job, "fetch_list", lambda url, *_: calls.append(("list", url)) or "list")
    monkeypatch.setattr(job, "parse_list", lambda *_: [NOTICE, NOTICE])
    monkeypatch.setattr(job, "fetch_detail", lambda url, *_: calls.append(("detail", url)) or "detail")
    monkeypatch.setattr(
        job,
        "parse_detail",
        lambda *_: SimpleNamespace(body_text="본문", body_html="<p>본문</p>", attachments=(), images=()),
    )
    assert job.run_collection(SETTINGS, store, NOW) == (1, 0)
    assert len(store.rows) == 1
    assert store.rows["school/123"]["body"] == "본문"
    assert [x[0] for x in calls] == ["list", "detail"]
    calls.clear()
    assert job.run_collection(SETTINGS, store, NOW) == (1, 0)
    assert [x[0] for x in calls] == ["list"]
    assert store.sources["school"]["last_success_at"] == NOW.isoformat()


def test_failed_board_does_not_replace_last_success(monkeypatch):
    store = MemoryStore()
    store.sources["school"] = {**SOURCES[0], "last_success_at": "2026-11-01T00:00:00+09:00"}
    monkeypatch.setattr(job, "fetch_list", lambda *_: (_ for _ in ()).throw(FetchError("failed")))
    assert job.run_collection(SETTINGS, store, NOW) == (0, 1)
    assert store.sources["school"]["last_success_at"] == "2026-11-01T00:00:00+09:00"
    assert not store.writes


def test_secret_key_is_sent_only_as_apikey_and_invalid_host_is_rejected():
    with pytest.raises(ValueError):
        job.NoticeStore("https://example.com", "sb_secret_test")
    store = job.NoticeStore("https://example.supabase.co", "sb_secret_test")
    calls = []
    store.client._transport = httpx.MockTransport(
        lambda request: calls.append(request) or httpx.Response(200, json=[])
    )
    try:
        assert store.source("school") is None
        assert calls[0].headers["apikey"] == "sb_secret_test"
        assert "authorization" not in calls[0].headers
    finally:
        store.close()


def test_detail_failure_keeps_old_text_and_retries_next_run(monkeypatch):
    store = MemoryStore()
    store.rows["school/123"] = {
        "id": "school/123",
        "source_id": "school",
        "article_no": "123",
        "title": "이전 제목",
        "category": "학사",
        "url": NOTICE.url,
        "posted_on": "2026-11-06",
        "pinned": False,
        "deadline": None,
        "first_seen": "2026-11-01T00:00:00+09:00",
        "fetched_at": "2026-11-01T00:00:00+09:00",
        "body": "이전 본문",
        "body_html": None,
        "attachments": [],
        "images": [],
    }
    monkeypatch.setattr(job.time, "sleep", lambda _: None)
    monkeypatch.setattr(job, "fetch_list", lambda *_: "list")
    monkeypatch.setattr(job, "parse_list", lambda *_: [NOTICE])
    monkeypatch.setattr(job, "fetch_detail", lambda *_: (_ for _ in ()).throw(FetchError("failed")))
    assert job.run_collection(SETTINGS, store, NOW) == (1, 0)
    assert store.rows["school/123"]["body"] == "이전 본문"
    assert store.rows["school/123"]["fetched_at"] is None
    monkeypatch.setattr(job, "fetch_detail", lambda *_: "detail")
    monkeypatch.setattr(
        job,
        "parse_detail",
        lambda *_: SimpleNamespace(
            body_text="새 본문", body_html="<p>새 본문</p>", attachments=(), images=()
        ),
    )
    assert job.run_collection(SETTINGS, store, NOW) == (1, 0)
    assert store.rows["school/123"]["body"] == "새 본문"
    assert store.rows["school/123"]["first_seen"] == "2026-11-01T00:00:00+09:00"
