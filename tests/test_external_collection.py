from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from skku_notice import scheduled_collection as collection

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(collection.time, "sleep", lambda _seconds: None)
    # 학생인재개발팀은 공개 목록 HTML을 그대로 읽는다(원본과 같다). 네트워크 없이 보관한 화면으로 대신한다.
    list_page = (FIXTURES / "skku_career_intern_list_2026-11-06.html").read_text()
    view_page = (FIXTURES / "skku_career_intern_view_165070_2026-11-06.html").read_text()
    monkeypatch.setattr(collection, "fetch_list", lambda url, agent, timeout: list_page)
    monkeypatch.setattr(collection, "fetch_detail", lambda url, agent, timeout: view_page)


NOW = datetime(2026, 11, 7, 3, 0, tzinfo=UTC)
SETTINGS = {
    "user_agent": "test",
    "timeout_seconds": 5,
    "request_gap_seconds": 0,
    "sources": [
        {"id": "cse-notice", "kind": "skku-cms", "name": "학교", "url": "https://cse.skku.edu/n"},
        {"id": "linkareer-intern", "kind": "linkareer", "name": "링커리어", "url": "https://linkareer.com/list/intern",
         "external": True},
    ],
}
CAREER = {"id": "skku-career-intern", "kind": "skku-career-intern", "name": "학생인재개발팀",
          "url": "https://job.skku.edu/Recruit/RecruitInternList.aspx?rp=1", "external": True}


class MemoryStore:
    def __init__(self, sources=None, notices=None):
        self.sources = sources or {}
        self.rows = notices or {}
        self.upserts = []

    def source(self, source_id):
        return self.sources.get(source_id)

    def notices(self, source_id, numbers):
        keys = [f"{source_id}/{n}" for n in numbers]
        return {key: self.rows[key] for key in keys if key in self.rows}

    def upsert(self, table, rows):
        self.upserts.append((table, rows))
        for row in rows:
            (self.sources if table == "platform_sources" else self.rows)[row["id"]] = row


def fake_post(count=7, detail_ok=True):
    calls = []

    def post(url, body, headers):
        calls.append(body)
        if "activities" in body["query"]:
            start = int((NOW - timedelta(days=1)).timestamp() * 1000)
            close = int((NOW + timedelta(days=5)).timestamp() * 1000)
            return {"data": {"activities": {"nodes": [
                {"id": str(1000 + i), "title": f"백엔드 인턴 {i}", "organizationName": "회사",
                 "recruitStartAt": start, "recruitCloseAt": close, "categories": [],
                 "distinctInternTypes": [{"name": "개발"}]} for i in range(count)]}}}
        number = body["variables"]["id"]
        if not detail_ok:
            return {"data": {"activity": None}, "errors": [{"message": "x"}]}
        return {"data": {"activity": {"id": number, "detailText": {"text": "<p>주요 업무: 서버 개발</p>"}}}}

    post.calls = calls
    return post


def test_collects_list_then_at_most_five_bodies_and_skips_non_external_boards():
    store, post = MemoryStore(), fake_post(count=7)
    total, failed = collection.run_external_collection(SETTINGS, store, NOW, post)
    assert (total, failed) == (7, 0)
    assert store.sources["linkareer-intern"]["external"] is True
    assert "cse-notice" not in store.sources
    rows = [r for r in store.rows.values()]
    assert len(rows) == 7 and all(r["source_id"] == "linkareer-intern" and r["pinned"] is False for r in rows)
    assert sum(1 for r in rows if r["fetched_at"]) == 5
    assert all("서버 개발" in r["body"] for r in rows if r["fetched_at"])
    assert sum(1 for c in post.calls if "activities" in c["query"]) == 1  # one list request per site
    assert rows[0]["deadline"]


def test_does_not_hit_the_site_again_within_an_hour_and_continues_bodies_after():
    store = MemoryStore()
    collection.run_external_collection(SETTINGS, store, NOW, fake_post(count=7))
    again = fake_post(count=7)
    assert collection.run_external_collection(SETTINGS, store, NOW + timedelta(minutes=30), again) == (0, 0)
    assert again.calls == []
    later = fake_post(count=7)
    collection.run_external_collection(SETTINGS, store, NOW + timedelta(minutes=60), later)
    assert all(r["fetched_at"] for r in store.rows.values())
    assert sum(1 for c in later.calls if "activities" not in c["query"]) == 2  # only the two still missing


def test_failed_body_stays_empty_for_a_retry_and_title_change_is_recorded():
    store = MemoryStore()
    collection.run_external_collection(SETTINGS, store, NOW, fake_post(count=2, detail_ok=False))
    assert all(r["fetched_at"] is None and r["body"] is None for r in store.rows.values())
    store.rows["linkareer-intern/1000"]["title"] = "[회사] 예전 제목"
    later = NOW + timedelta(hours=2)
    collection.run_external_collection(SETTINGS, store, later, fake_post(count=2))
    row = store.rows["linkareer-intern/1000"]
    assert row["change_kind"] == "제목" and row["previous_title"] == "[회사] 예전 제목" and row["changed_at"]
    assert row["fetched_at"]


def test_list_failure_is_counted_and_does_not_raise():
    def broken(url, body, headers):
        return {"errors": [{"message": "x"}]}

    assert collection.run_external_collection(SETTINGS, MemoryStore(), NOW, broken) == (0, 1)


def test_school_career_center_is_read_from_its_public_list_with_the_same_limits():
    settings = {**SETTINGS, "sources": [CAREER]}
    store = MemoryStore()
    now = datetime(2026, 11, 3, 3, 0, tzinfo=UTC)
    total, failed = collection.run_external_collection(settings, store, now)
    assert (total, failed) == (20, 0)
    assert store.sources["skku-career-intern"]["external"] is True
    rows = list(store.rows.values())
    assert len(rows) == 20 and all(r["source_id"] == "skku-career-intern" for r in rows)
    assert sum(1 for r in rows if r["fetched_at"]) <= collection.EXTERNAL_DETAILS_PER_RUN
    # 한 시간 안에는 다시 읽지 않는다.
    assert collection.run_external_collection(settings, store, now + timedelta(minutes=30)) == (0, 0)


def test_career_center_parse_failure_is_counted_and_does_not_raise(monkeypatch):
    monkeypatch.setattr(collection, "fetch_list", lambda url, agent, timeout: "<html></html>")
    assert collection.run_external_collection({**SETTINGS, "sources": [CAREER]}, MemoryStore(), NOW) == (0, 1)
