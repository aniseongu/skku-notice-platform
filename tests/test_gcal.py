import json
from datetime import datetime

import httpx
import pytest

from skku_notice import gcal
from skku_notice.deadline import KST

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=KST)


def _notice(no: str, deadline: str | None, url: str = "https://cse.skku.edu/") -> dict:
    return {"id": f"cse-notice:{no}", "source_id": "cse-notice", "article_no": no, "title": f"공지 {no}",
            "category": "채용", "url": url + no, "posted_on": "2026-11-01", "pinned": False,
            "deadline": deadline, "first_seen": None}


def test_desired_events_include_only_saved_future_deadlines():
    notices = [
        _notice("1", "2026-11-16T10:00:00+09:00"),   # 기준에 맞음
        _notice("2", "2026-11-16T10:00:00+09:00"),   # 해당 없음
        _notice("3", "2026-11-01T10:00:00+09:00"),   # 지난 마감
        _notice("4", "2026-11-20T23:59:00+09:00"),   # 저장만
        _notice("5", None),                           # 마감 없음
        _notice("6", "2026-11-16T10:00:00+09:00", url="javascript:alert"),
    ]
    events = gcal.desired_events(notices, [notices[0], notices[2], notices[3], {"bad": 1}], NOW)
    titles = sorted(event["summary"] for event in events.values())
    assert titles == ["공지 1", "공지 4"]
    first = events[gcal._event_id("cse-notice:1")]
    assert first["start"]["dateTime"] == "2026-11-16T09:30:00+09:00"
    assert first["end"]["dateTime"] == "2026-11-16T10:00:00+09:00"
    assert first["extendedProperties"]["private"][gcal.MARK] == "cse-notice:1"
    assert all(set(key) <= set("abcdefghijklmnopqrstuv0123456789") for key in events)


def test_external_notices_require_save_and_use_current_or_saved_snapshot():
    current = {**_notice("1", "2026-11-20T10:00:00+09:00"), "id": "jobs:1", "source_id": "jobs"}
    unsaved = {**current, "id": "jobs:2", "title": "저장하지 않은 인턴"}
    snapshot = {**current, "deadline": "2026-11-19T10:00:00+09:00"}
    archived = {**snapshot, "id": "jobs:3", "title": "목록에서 빠진 인턴"}
    events = gcal.desired_events([current, unsaved], [snapshot, archived], NOW, frozenset({"jobs"}))
    assert set(events) == {gcal._event_id("jobs:1"), gcal._event_id("jobs:3")}
    assert events[gcal._event_id("jobs:1")]["end"]["dateTime"] == current["deadline"]
    assert not gcal.desired_events([unsaved], [], NOW, frozenset({"jobs"}))


def test_ineligible_internships_are_excluded_from_calendar():
    school = {**_notice("1", "2026-11-20T10:00:00+09:00"), "title": "졸업예정자 인턴 모집"}
    external = {**school, "id": "jobs:1", "source_id": "jobs", "title": "개발 모집"}
    judgments = {n["id"]: {"ai": {"verdict": "not_relevant"}} for n in (school, external)}
    assert not gcal.desired_events([school, external], [external], NOW, frozenset({"jobs"}), judgments)


def test_sync_only_touches_events_this_app_made():
    keep = gcal.desired_events([_notice("1", "2026-11-16T10:00:00+09:00")],
                               [_notice("1", "2026-11-16T10:00:00+09:00")], NOW)
    new = gcal.desired_events([_notice("9", "2026-11-18T10:00:00+09:00")],
                              [_notice("9", "2026-11-18T10:00:00+09:00")], NOW)
    keep_id = next(iter(keep))
    listing = {"items": [
        {"id": keep_id, **keep[keep_id]},
        {"id": "skkuoldone", "extendedProperties": {"private": {gcal.MARK: "cse-notice:old"}}},
        {"id": "mine123", "summary": "사용자가 직접 넣은 일정"},
    ]}
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path.rsplit("/", 1)[-1]))
        if request.method == "GET":
            return httpx.Response(200, json=listing)
        return httpx.Response(200 if request.method != "DELETE" else 204, json={})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = gcal.sync(client, "abc@group.calendar.google.com", {**keep, **new})
    assert result == (1, 0, 1)
    assert ("POST", "events") in calls
    assert ("DELETE", "skkuoldone") in calls
    assert not any(target == "mine123" for _, target in calls)


def test_revoked_google_connection_has_a_safe_message():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "invalid_grant", "error_description": "SECRET_DETAIL"})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(gcal.CalendarError) as caught:
            gcal.access_token(client, "id", "secret", "refresh")
    assert "다시 연결" in str(caught.value)
    assert "SECRET" not in str(caught.value)


def test_main_skips_until_connected(monkeypatch, capsys, tmp_path):
    for name in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GOOGLE_CALENDAR_ID"):
        monkeypatch.delenv(name, raising=False)
    assert gcal.main(tmp_path) == 0
    assert "연결 전" in capsys.readouterr().out


def test_invalid_bundle_never_falls_back_to_legacy(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("GOOGLE_CONNECTION", '{"client_secret": "private"}')
    monkeypatch.setenv("GOOGLE_REFRESH_TOKEN", "old-refresh")
    assert gcal.main(tmp_path) == 1
    output = capsys.readouterr()
    assert "다시 저장" in output.err
    assert "private" not in output.err


def test_main_reports_counts_without_secrets(monkeypatch, capsys, tmp_path):
    notices = {"notices": [_notice("1", "2026-12-16T10:00:00+09:00")]}
    (tmp_path / "notices.json").write_text(json.dumps(notices))
    (tmp_path / "matched.json").write_text(json.dumps({"items": {"cse-notice:1": {"rule_name": "채용"}}}))
    monkeypatch.setenv("SAVED_NOTICES", json.dumps(notices["notices"]))
    settings = {
        "GOOGLE_CLIENT_ID": "client-id-value", "GOOGLE_CLIENT_SECRET": "client-secret-value",
        "GOOGLE_REFRESH_TOKEN": "refresh-token-value", "GOOGLE_CALENDAR_ID": "abc@group.calendar.google.com",
    }
    for name, value in settings.items():
        monkeypatch.setenv(name, value)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "access-token-value"})
        if request.method == "GET":
            return httpx.Response(200, json={"items": []})
        return httpx.Response(200, json={})

    real = httpx.Client
    monkeypatch.setattr(gcal.httpx, "Client", lambda **kwargs: real(transport=httpx.MockTransport(handler)))
    assert gcal.main(tmp_path) == 0
    out = capsys.readouterr()
    assert "넣음 1" in out.out
    assert "token-value" not in out.out + out.err and "secret-value" not in out.out + out.err


def test_bundle_credentials_override_legacy(monkeypatch, capsys, tmp_path):
    (tmp_path / "notices.json").write_text(json.dumps({"notices": []}))
    (tmp_path / "matched.json").write_text(json.dumps({"items": {}}))
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "old")
    monkeypatch.setenv("GOOGLE_CONNECTION", json.dumps({
        "client_id": "new-id", "client_secret": "new-secret", "refresh_token": "new-refresh",
        "calendar_id": "new@group.calendar.google.com",
    }))
    captured = []
    monkeypatch.setattr(gcal, "access_token", lambda client, *args: captured.append(args) or "access")
    monkeypatch.setattr(gcal, "sync", lambda client, calendar_id, desired: (0, 0, 0))
    assert gcal.main(tmp_path) == 0
    assert captured == [("new-id", "new-secret", "new-refresh")]


def test_started_event_is_removed_when_notice_is_marked_passed():
    started = {**_notice("started", "2026-11-03T11:45:00+09:00"), "deadline_kind": "일정"}
    assert not gcal.desired_events([started], [started], NOW)


def test_sync_updates_previous_deadline_prefix():
    notice = _notice("1", "2026-11-16T10:00:00+09:00")
    desired = gcal.desired_events([notice], [notice], NOW)
    event_id, event = next(iter(desired.items()))
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.method)
        if request.method == "GET":
            old = {"id": event_id, **event, "summary": "[마감] 공지 1"}
            return httpx.Response(200, json={"items": [old]})
        return httpx.Response(200, json={})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert gcal.sync(client, "calendar", desired) == (0, 1, 0)
    assert calls == ["GET", "PUT"]
