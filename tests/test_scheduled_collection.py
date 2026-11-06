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


def test_one_failed_board_does_not_stop_other_boards(monkeypatch):
    from dataclasses import replace

    store = MemoryStore()
    second = {**SOURCES[0], "id": "school2", "url": "https://www.skku.edu/other"}
    settings = {**SETTINGS, "sources": [SOURCES[0], second]}
    monkeypatch.setattr(job.time, "sleep", lambda _: None)

    def fetch(url, *_):
        if url == SOURCES[0]["url"]:
            raise FetchError("first board unavailable")
        return "list"

    monkeypatch.setattr(job, "fetch_list", fetch)
    monkeypatch.setattr(
        job, "parse_list", lambda _html, source_id, _url: [replace(NOTICE, source_id=source_id)]
    )
    monkeypatch.setattr(job, "fetch_detail", lambda *_: "detail")
    monkeypatch.setattr(
        job,
        "parse_detail",
        lambda *_: SimpleNamespace(body_text="본문", body_html="<p>본문</p>", attachments=(), images=()),
    )
    assert job.run_collection(settings, store, NOW) == (1, 1)
    assert "school/123" not in store.rows
    assert store.rows["school2/123"]["body"] == "본문"


def test_old_body_is_rechecked_and_changes_are_recorded(monkeypatch):
    store = MemoryStore()
    store.rows["school/123"] = {
        "id": "school/123",
        "source_id": "school",
        "article_no": "123",
        "title": NOTICE.title,
        "category": NOTICE.category,
        "url": NOTICE.url,
        "posted_on": NOTICE.posted_on.isoformat(),
        "pinned": False,
        "deadline": None,
        "first_seen": "2026-11-01T00:00:00+09:00",
        "fetched_at": "2026-11-01T00:00:00+09:00",
        "body": "이전 본문",
        "body_html": "<p>이전 본문</p>",
        "attachments": [],
        "images": [],
    }
    monkeypatch.setattr(job.time, "sleep", lambda _: None)
    monkeypatch.setattr(job, "fetch_list", lambda *_: "list")
    monkeypatch.setattr(job, "parse_list", lambda *_: [NOTICE])
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
    assert store.rows["school/123"]["change_kind"] == "본문"
    assert store.rows["school/123"]["changed_at"] == NOW.isoformat()
    assert store.rows["school/123"]["first_seen"] == "2026-11-01T00:00:00+09:00"


def test_rechecks_only_oldest_body_per_board(monkeypatch):
    from dataclasses import replace

    store = MemoryStore()
    second = replace(
        NOTICE, article_no="124", title="다른 공지", url="https://www.skku.edu/notice?articleNo=124"
    )
    for notice, checked in [(NOTICE, "2026-11-01T00:00:00+09:00"), (second, "2026-11-02T00:00:00+09:00")]:
        store.rows[f"school/{notice.article_no}"] = {
            "id": f"school/{notice.article_no}",
            "source_id": "school",
            "article_no": notice.article_no,
            "title": notice.title,
            "category": notice.category,
            "url": notice.url,
            "posted_on": notice.posted_on.isoformat(),
            "pinned": False,
            "deadline": None,
            "first_seen": checked,
            "fetched_at": checked,
            "body": "본문",
            "body_html": "<p>본문</p>",
            "attachments": [],
            "images": [],
        }
    requested = []
    monkeypatch.setattr(job.time, "sleep", lambda _: None)
    monkeypatch.setattr(job, "fetch_list", lambda *_: "list")
    monkeypatch.setattr(job, "parse_list", lambda *_: [NOTICE, second])
    monkeypatch.setattr(job, "fetch_detail", lambda url, *_: requested.append(url) or "detail")
    monkeypatch.setattr(
        job,
        "parse_detail",
        lambda *_: SimpleNamespace(body_text="본문", body_html="<p>본문</p>", attachments=(), images=()),
    )
    assert job.run_collection(SETTINGS, store, NOW) == (2, 0)
    assert requested == [NOTICE.url]
    assert store.rows["school/123"]["change_kind"] is None
    assert store.rows["school/124"]["fetched_at"] == "2026-11-02T00:00:00+09:00"


def test_freshness_gate_skips_only_when_all_school_boards_were_recently_collected():
    from datetime import timedelta

    store = MemoryStore()
    store.sources["school"] = {"id": "school", "last_success_at": (NOW - timedelta(minutes=20)).isoformat()}
    assert job.recently_collected(SETTINGS, store, NOW)
    store.sources["school"]["last_success_at"] = (NOW - timedelta(minutes=51)).isoformat()
    assert not job.recently_collected(SETTINGS, store, NOW)
    store.sources["school"]["last_success_at"] = (NOW + timedelta(minutes=1)).isoformat()
    assert not job.recently_collected(SETTINGS, store, NOW)
    store.sources.clear()
    assert not job.recently_collected(SETTINGS, store, NOW)
