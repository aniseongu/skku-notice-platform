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


def test_title_change_delayed_by_detail_budget_is_retried(monkeypatch):
    store = MemoryStore()
    store.rows["school/123"] = {
        "id": "school/123", "source_id": "school", "article_no": "123", "title": "이전 제목",
        "category": NOTICE.category, "url": NOTICE.url, "posted_on": NOTICE.posted_on.isoformat(),
        "pinned": False, "first_seen": NOW.isoformat(), "fetched_at": NOW.isoformat(),
        "body": "이전 본문", "body_html": None, "attachments": [], "images": [],
    }
    monkeypatch.setattr(job.time, "sleep", lambda _: None)
    monkeypatch.setattr(job, "fetch_list", lambda *_: "list")
    monkeypatch.setattr(job, "parse_list", lambda *_: [NOTICE])
    monkeypatch.setattr(job, "fetch_detail", lambda *_: "detail")
    monkeypatch.setattr(job, "parse_detail", lambda *_: SimpleNamespace(
        body_text="수정된 본문", body_html=None, attachments=(), images=()))
    monkeypatch.setattr(job, "DETAIL_BUDGET", 0)
    job.run_collection(SETTINGS, store, NOW)
    assert store.rows["school/123"]["fetched_at"] is None
    assert store.rows["school/123"]["body"] == "이전 본문"
    monkeypatch.setattr(job, "DETAIL_BUDGET", 1)
    job.run_collection(SETTINGS, store, NOW)
    assert store.rows["school/123"]["body"] == "수정된 본문"


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


def _recheck_requests(monkeypatch, specs):
    """specs: [(article_no, first_seen_hours_ago, fetched_hours_ago)] -> requested detail URLs."""
    from dataclasses import replace
    from datetime import timedelta

    store = MemoryStore()
    notices = []
    for no, seen_h, fetched_h in specs:
        n = replace(NOTICE, article_no=no, title=f"공지{no}", url=f"https://www.skku.edu/notice?articleNo={no}")
        notices.append(n)
        store.rows[f"school/{no}"] = {
            "id": f"school/{no}", "source_id": "school", "article_no": no, "title": n.title,
            "category": n.category, "url": n.url, "posted_on": n.posted_on.isoformat(),
            "pinned": False, "deadline": None,
            "first_seen": (NOW - timedelta(hours=seen_h)).isoformat(),
            "fetched_at": (NOW - timedelta(hours=fetched_h)).isoformat(),
            "body": "본문", "body_html": "<p>본문</p>", "attachments": [], "images": [],
        }
    requested = []
    monkeypatch.setattr(job.time, "sleep", lambda _: None)
    monkeypatch.setattr(job, "fetch_list", lambda *_: "list")
    monkeypatch.setattr(job, "parse_list", lambda *_: notices)
    monkeypatch.setattr(job, "fetch_detail", lambda url, *_: requested.append(url) or "detail")
    monkeypatch.setattr(
        job, "parse_detail",
        lambda *_: SimpleNamespace(body_text="본문", body_html="<p>본문</p>", attachments=(), images=()),
    )
    job.run_collection(SETTINGS, store, NOW)
    return requested


def test_recent_notice_is_rechecked_after_three_hours(monkeypatch):
    assert len(_recheck_requests(monkeypatch, [("1", 10, 4)])) == 1


def test_non_recent_notice_is_not_rechecked_after_three_hours(monkeypatch):
    assert _recheck_requests(monkeypatch, [("1", 72, 4)]) == []


def test_recent_notice_is_preferred_over_older_due_notice(monkeypatch):
    requested = _recheck_requests(monkeypatch, [("1", 100, 30), ("2", 10, 4)])
    assert requested == ["https://www.skku.edu/notice?articleNo=2"]


def test_freshness_gate_skips_only_when_all_school_boards_were_recently_collected():
    from datetime import timedelta

    store = MemoryStore()
    store.sources["school"] = {"id": "school", "last_success_at": (NOW - timedelta(minutes=20)).isoformat()}
    assert job.recently_collected(SETTINGS, store, NOW)
    store.sources["school"]["last_success_at"] = (NOW - timedelta(minutes=25)).isoformat()
    assert not job.recently_collected(SETTINGS, store, NOW)
    store.sources["school"]["last_success_at"] = (NOW - timedelta(minutes=30)).isoformat()
    assert not job.recently_collected(SETTINGS, store, NOW)
    store.sources["school"]["last_success_at"] = (NOW + timedelta(minutes=1)).isoformat()
    assert not job.recently_collected(SETTINGS, store, NOW)
    store.sources.clear()
    assert not job.recently_collected(SETTINGS, store, NOW)


CATALOG = {
    "sources": [
        {"id": "school", "name": "학교", "kind": "skku-cms", "url": "https://www.skku.edu/notice"},
        {"id": "dept-a", "name": "A학과 공지", "kind": "skku-cms", "on_demand": True,
         "url": "https://a.skku.edu/notice.do"},
        {"id": "dept-b", "name": "B학과 공지", "kind": "skku-cms", "on_demand": True,
         "url": "https://b.skku.edu/notice.do"},
    ],
    "user_agent": "test",
    "timeout_seconds": 2,
}


def _notice(source_id, number):
    return Notice(source_id, str(number), f"공지 {number}", "학사",
                  f"https://x.skku.edu/?articleNo={number}", date(2026, 11, 6), False)


def test_catalog_boards_are_collected_only_when_someone_follows_them(monkeypatch):
    monkeypatch.setattr(job.time, "sleep", lambda _: None)
    fetched = []
    monkeypatch.setattr(job, "fetch_list", lambda url, *_: fetched.append(url) or "list")
    monkeypatch.setattr(job, "parse_list", lambda _html, source_id, _url: [_notice(source_id, 1)])
    monkeypatch.setattr(job, "fetch_detail", lambda *_: "detail")
    monkeypatch.setattr(job, "parse_detail", lambda *_: SimpleNamespace(
        body_text="본문", body_html="<p>본문</p>", attachments=(), images=()))
    assert [s["id"] for s in job.collection_targets(CATALOG, set())] == ["school"]
    assert [s["id"] for s in job.collection_targets(CATALOG, {"dept-b"})] == ["school", "dept-b"]
    store = MemoryStore()
    assert job.run_collection(CATALOG, store, NOW, {"dept-b"}) == (2, 0)
    assert fetched == ["https://www.skku.edu/notice", "https://b.skku.edu/notice.do"]
    assert set(store.sources) == {"school", "dept-b"}


def test_catalog_registration_makes_boards_subscribable_without_collecting():
    registered = []

    class Store:
        def register_sources(self, rows):
            registered.extend(rows)

    job.register_catalog(CATALOG, Store())
    assert registered == [
        {"id": "dept-a", "name": "A학과 공지", "url": "https://a.skku.edu/notice.do"},
        {"id": "dept-b", "name": "B학과 공지", "url": "https://b.skku.edu/notice.do"},
    ]


def test_detail_budget_spreads_a_first_backfill_over_several_runs(monkeypatch):
    monkeypatch.setattr(job.time, "sleep", lambda _: None)
    monkeypatch.setattr(job, "DETAIL_BUDGET", 3)
    monkeypatch.setattr(job, "fetch_list", lambda *_: "list")
    monkeypatch.setattr(
        job, "parse_list", lambda _h, source_id, _u: [_notice(source_id, n) for n in range(1, 8)]
    )
    details = []
    monkeypatch.setattr(job, "fetch_detail", lambda url, *_: details.append(url) or "detail")
    monkeypatch.setattr(job, "parse_detail", lambda *_: SimpleNamespace(
        body_text="본문", body_html="<p>본문</p>", attachments=(), images=()))
    store = MemoryStore()
    one_board = {**CATALOG, "sources": CATALOG["sources"][:1]}
    assert job.run_collection(one_board, store, NOW) == (7, 0)
    assert len(details) == 3
    assert sum(1 for row in store.rows.values() if row["fetched_at"]) == 3
    job.run_collection(one_board, store, NOW)
    assert len(details) == 6, "the next run continues with the notices that still have no body"


def test_freshness_gate_ignores_catalog_boards_nobody_follows():
    class Store:
        def source(self, source_id):
            return {"last_success_at": NOW.isoformat()} if source_id == "school" else None

    assert job.recently_collected(CATALOG, Store(), NOW) is True
    assert job.recently_collected(CATALOG, Store(), NOW, subscribed={"dept-a"}) is False


def test_a_notice_the_school_redates_keeps_its_first_seen_posting_date(monkeypatch):
    store = MemoryStore()
    monkeypatch.setattr(job.time, "sleep", lambda _: None)
    monkeypatch.setattr(job, "fetch_list", lambda *_: "list")
    monkeypatch.setattr(job, "fetch_detail", lambda *_: "detail")
    monkeypatch.setattr(
        job, "parse_detail",
        lambda *_: SimpleNamespace(body_text="본문", body_html="<p>본문</p>", attachments=(), images=()),
    )
    monkeypatch.setattr(job, "parse_list", lambda *_: [NOTICE])
    assert job.run_collection(SETTINGS, store, NOW) == (1, 0)
    assert store.rows["school/123"]["posted_on"] == "2026-11-06"
    # 학교가 글을 고쳐 목록의 날짜를 오늘로 바꿔도 처음 본 게시일을 지키고, 다른 값은 그대로 갱신한다.
    redated = Notice("school", "123", "학교 공지", "학사", NOTICE.url, date(2026, 11, 10), True)
    monkeypatch.setattr(job, "parse_list", lambda *_: [redated])
    assert job.run_collection(SETTINGS, store, NOW) == (1, 0)
    row = store.rows["school/123"]
    assert row["posted_on"] == "2026-11-06"
    assert row["pinned"] is True


def test_a_new_notice_uses_the_listed_date_and_a_broken_saved_date_is_replaced():
    listed = date(2026, 11, 10)
    assert job._first_posted_on({}, listed) == listed
    assert job._first_posted_on({"posted_on": None}, listed) == listed
    assert job._first_posted_on({"posted_on": "not-a-date"}, listed) == listed
    assert job._first_posted_on({"posted_on": "2026-11-06"}, listed) == date(2026, 11, 6)
