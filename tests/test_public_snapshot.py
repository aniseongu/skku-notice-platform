import json
from datetime import date, datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from skku_notice import public_snapshot
from skku_notice.fetch import FetchError
from skku_notice.model import Notice

NOW = datetime(2026, 11, 7, tzinfo=ZoneInfo("Asia/Seoul"))
SCHOOL = {"id": "school", "kind": "skku-cms", "name": "학교", "url": "https://www.skku.edu/notice.do"}
INTERN = {"id": "linkareer", "kind": "linkareer", "external": True, "name": "인턴", "url": "https://example.com"}
SETTINGS = {"sources": [SCHOOL, INTERN], "user_agent": "test", "timeout_seconds": 1}


def test_snapshot_contains_only_public_school_data(tmp_path, monkeypatch):
    notice = Notice("school", "123", "학교 공지", "학사", "https://www.skku.edu/notice.do?articleNo=123",
                    date(2026, 11, 6), False)
    requested = []
    monkeypatch.setattr(public_snapshot.time, "sleep", lambda _: None)
    monkeypatch.setattr(public_snapshot, "fetch_list", lambda url, *_: requested.append(url) or "list")
    monkeypatch.setattr(public_snapshot, "parse_list", lambda *_: [notice])
    monkeypatch.setattr(public_snapshot, "fetch_detail", lambda url, *_: requested.append(url) or "detail")
    monkeypatch.setattr(public_snapshot, "parse_detail", lambda *_: SimpleNamespace(
        body_text="본문", body_html="<p>본문</p>", attachments=(), images=()))
    assert public_snapshot.collect_snapshot(SETTINGS, tmp_path, NOW) == (1, 1)
    data = json.loads((tmp_path / "notices.json").read_text())
    detail = json.loads((tmp_path / "notices/school/123.json").read_text())
    assert [s["id"] for s in data["sources"]] == ["school"]
    assert data["notices"][0]["id"] == "school/123"
    assert detail["body"] == "본문"
    assert all(url.startswith("https://www.skku.edu/") for url in requested)
    assert not (tmp_path / "matched.json").exists()


def test_list_failure_never_replaces_previous_snapshot(tmp_path, monkeypatch):
    old = tmp_path / "notices.json"
    old.write_text('{"old":true}')
    monkeypatch.setattr(public_snapshot, "fetch_list", lambda *_: (_ for _ in ()).throw(FetchError("failed")))
    with pytest.raises(FetchError):
        public_snapshot.collect_snapshot(SETTINGS, tmp_path, NOW)
    assert old.read_text() == '{"old":true}'
