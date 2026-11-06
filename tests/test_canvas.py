import argparse
import json
import os
from dataclasses import replace
from datetime import datetime, time, timedelta
from pathlib import Path

import httpx
import pytest

from skku_notice import canvas, cli
from skku_notice.archive import Archive
from skku_notice.canvas_alerts import CanvasState, mark_sent, plan_alerts
from skku_notice.deadline import KST
from skku_notice.export import export_site

FIXTURES = Path("tests/fixtures/canvas")
NOW = datetime(2026, 11, 2, 20, 40, tzinfo=KST)


def test_fixture_filters_completed_and_classifies() -> None:
    items = canvas.read_canvas("", NOW, FIXTURES)
    assert [(item.kind, item.title) for item in items] == [
        ("강의", "그래프 강의"),
        ("과제", "트리 과제"),
        ("퀴즈", "중간 퀴즈"),
    ]


def test_canvas_pat_never_goes_to_learningx_session_api(monkeypatch) -> None:
    requests = []

    def respond(request):
        requests.append(request)
        if request.url.path.endswith("favorites/courses"):
            return httpx.Response(200, json=[{"id": 101, "name": "테스트 과목"}])
        if request.url.path.endswith("assignments"):
            return httpx.Response(200, json=[{
                "id": 1, "name": "미제출 과제", "due_at": "2026-11-03T12:00:00Z",
                "submission_types": ["online_upload"], "submission": {},
            }])
        raise AssertionError("Canvas PAT was sent to a non-Canvas resource")

    original = httpx.Client
    monkeypatch.setattr(canvas.httpx, "Client", lambda **kwargs: original(
        transport=httpx.MockTransport(respond), **kwargs,
    ))
    items = canvas.read_canvas("fixture-pat", NOW, gap=0)
    assert [item.title for item in items] == ["미제출 과제"]
    assert len(requests) == 2
    assert all(request.url.path.startswith("/api/v1/") for request in requests)


def test_baseline_missed_lead_and_ttl() -> None:
    items = canvas.read_canvas("", NOW, FIXTURES)
    alerts, baseline = plan_alerts(items, CanvasState(), NOW, [1440, 180], time(9))
    assert len(alerts) == 3  # dry-run preview; the CLI suppresses first-run delivery
    assert "101:lecture:301|m180" in baseline.notified
    state = mark_sent(baseline, alerts[0], NOW)
    later = NOW + timedelta(minutes=1)
    alerts, _ = plan_alerts(items, state, later, [1440, 180], time(9))
    assert not alerts
    aged = replace(state, notified={"old|m180": (NOW - timedelta(days=31)).isoformat()})
    _, trimmed = plan_alerts(items, aged, later, [1440, 180], time(9))
    assert "old|m180" not in trimmed.notified


def test_missing_larger_lead_sends_smallest_once() -> None:
    items = canvas.read_canvas("", NOW, FIXTURES)
    alerts, state = plan_alerts(items, CanvasState(initialized=True), NOW, [1440, 180], time(9))
    lecture = next(alert for alert in alerts if alert.keys and "그래프 강의" in alert.body)
    assert lecture.keys == ("101:lecture:301|m180", "101:lecture:301|m1440")
    state = mark_sent(state, lecture, NOW)
    alerts, _ = plan_alerts(items, state, NOW, [1440, 180], time(9))
    assert not any(alert.keys and "그래프 강의" in alert.body for alert in alerts)


def test_network_401_has_no_request_details(monkeypatch) -> None:
    monkeypatch.setattr(canvas.time, 'sleep', lambda _: None)
    request = httpx.Request("GET", "https://canvas.skku.edu/api/v1/users/self/favorites/courses?secret=x")
    client = httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(401, request=request)))
    try:
        try:
            canvas._get_pages(client, canvas.FAVORITES, 0)
            raise AssertionError("expected CanvasError")
        except canvas.CanvasError as exc:
            assert str(exc) == "토큰 거절"
            assert "secret" not in str(exc)
    finally:
        client.close()


@pytest.mark.parametrize('statuses,expected,calls', [
    ([401, 200], 'ok', 2),
    ([401, 401], '토큰 거절', 2),
    ([503, 401, 401], '토큰 거절', 3),
    ([503, 503, 401], 'Canvas 인증 응답 확인 실패', 3),
])
def test_canvas_token_rejection_is_confirmed_once_within_request_limit(
    monkeypatch, statuses, expected, calls
):
    monkeypatch.setattr(canvas.time, 'sleep', lambda _: None)
    attempted = []

    def respond(request):
        status = statuses[len(attempted)]
        attempted.append(status)
        return httpx.Response(status, json=[] if status == 200 else {})

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        if expected == 'ok':
            assert canvas._get_pages(client, canvas.FAVORITES, 0) == []
        else:
            with pytest.raises(canvas.CanvasError, match=expected):
                canvas._get_pages(client, canvas.FAVORITES, 0)
    assert len(attempted) == calls


def test_export_contains_no_canvas_data(tmp_path: Path) -> None:
    export_site(tmp_path, Archive(), [], NOW, tmp_path / "missing-web")
    assert not (tmp_path / "canvas.json").exists()
    assert not (tmp_path / "api/v1/canvas.json").exists()
    assert "assignment" not in (tmp_path / "api/v1/notices.json").read_text()


def test_cli_fixture_dry_run_does_not_write_canvas_state(tmp_path: Path, monkeypatch, capsys) -> None:
    class FixtureDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW.astimezone(tz)

    # fixture의 강의 마감 뒤에 실행해도 같은 알림 경로를 검증한다.
    monkeypatch.setattr(cli, "datetime", FixtureDateTime)
    monkeypatch.setattr(cli, "CANVAS_STATE_PATH", tmp_path / "canvas.json")
    monkeypatch.setattr(cli, "STATE_PATH", tmp_path / "seen.json")
    monkeypatch.setattr(cli, "load_dotenv", lambda **kwargs: None)
    monkeypatch.delenv("CANVAS_TOKEN", raising=False)
    args = argparse.Namespace(
        rules=Path("config/rules.example.yaml"),
        dry_run=True,
        all=True,
        from_fixtures=True,
        no_ai=True,
        canvas_fixtures=FIXTURES,
        no_canvas=False,
        export=None,
    )
    assert cli.run(args) == 0
    output = capsys.readouterr().out
    assert "[새 글]" in output
    assert "[Canvas 알림 예정]" in output
    assert "그래프 강의" in output
    assert not cli.CANVAS_STATE_PATH.exists()


def test_rejected_token_problem_is_sent_once(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(cli, "CANVAS_STATE_PATH", tmp_path / "canvas.json")
    monkeypatch.setattr(cli, "STATE_PATH", tmp_path / "seen.json")
    monkeypatch.setattr(cli, "ARCHIVE_PATH", tmp_path / "archive.json")
    monkeypatch.setattr(cli, "load_dotenv", lambda **kwargs: None)
    monkeypatch.setenv("NOTIFY_URLS", "ntfys://fake-topic")
    monkeypatch.setenv("CANVAS_TOKEN", "fake-token")
    monkeypatch.setattr(
        cli, "read_canvas", lambda *args, **kwargs: (_ for _ in ()).throw(canvas.CanvasError("토큰 거절"))
    )
    sent = []
    monkeypatch.setattr(cli, "send_canvas", lambda *args, **kwargs: sent.append(args) or True)
    args = argparse.Namespace(
        rules=Path("config/rules.example.yaml"),
        dry_run=False,
        all=False,
        from_fixtures=True,
        no_ai=True,
        canvas_fixtures=None,
        no_canvas=False,
        export=None,
    )
    assert cli.run(args) == 1
    os.utime(cli.CANVAS_STATE_PATH, (0, 0))
    assert cli.run(args) == 1
    assert len(sent) == 1
    assert sent[0][:2] == (
        "아이캠퍼스 연결이 끊겼어요",
        "설정 화면에서 아이캠퍼스 토큰을 새로 넣어 주세요",
    )
    saved = cli.load_canvas_state(cli.CANVAS_STATE_PATH)
    assert saved.problem == {"code": "token-rejected", "notifiedProblem": True}
    assert "fake-token" not in cli.CANVAS_STATE_PATH.read_text()



def test_summary_mode_never_plans_individual_reminders() -> None:
    items = canvas.read_canvas("", NOW, FIXTURES)
    alerts, _ = plan_alerts(items, CanvasState(initialized=True), NOW, [], time(9))
    assert len(alerts) == 1
    assert alerts[0].summary_day
    assert not alerts[0].keys


def test_disabled_canvas_does_not_fetch_even_with_token(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(cli, "load_dotenv", lambda **kwargs: None)
    monkeypatch.setenv("CANVAS_TOKEN", "fixture-token")
    config = tmp_path / "canvas.yaml"
    config.write_text("enabled: false\n")
    monkeypatch.setattr(cli, "CANVAS_CONFIG_PATH", config)
    monkeypatch.setattr(cli, "read_canvas", lambda *args: pytest.fail("disabled Canvas fetched"))
    monkeypatch.setattr(cli, "STATE_PATH", tmp_path / "seen.json")
    args = argparse.Namespace(rules=Path("config/rules.example.yaml"), dry_run=True,
                             all=True, from_fixtures=True, no_ai=True, no_canvas=False)
    assert cli.run(args) == 0


@pytest.mark.parametrize("summary", [False, True])
def test_cli_forwards_summary_kind_to_canvas_delivery(tmp_path: Path, monkeypatch, summary) -> None:
    from skku_notice.canvas_alerts import CanvasAlert

    monkeypatch.setenv("NOTIFY_URLS", "ntfys://fake-topic")
    monkeypatch.setenv("CANVAS_TOKEN", "fixture-token")
    monkeypatch.setattr(cli, "load_dotenv", lambda **kwargs: None)
    monkeypatch.setattr(cli, "CANVAS_STATE_PATH", tmp_path / "canvas.json")
    monkeypatch.setattr(cli, "STATE_PATH", tmp_path / "seen.json")
    monkeypatch.setattr(cli, "ARCHIVE_PATH", tmp_path / "archive.json")
    monkeypatch.setattr(cli, "read_canvas", lambda *args, **kwargs: [])
    state = CanvasState(initialized=True)
    alert = CanvasAlert("알림", "본문", "https://canvas.skku.edu",
                        summary_day="2026-11-04" if summary else None)
    monkeypatch.setattr(cli, "load_canvas_state", lambda *args: state)
    monkeypatch.setattr(cli, "plan_alerts", lambda *args: ([alert], state))
    sent = []
    monkeypatch.setattr(cli, "send_canvas", lambda *args, **kwargs: sent.append(kwargs) or True)
    args = argparse.Namespace(rules=Path("config/rules.example.yaml"), dry_run=False,
                              all=False, from_fixtures=True, no_ai=True, no_canvas=False, export=None)
    assert cli.run(args) == 0
    assert sent == [{"summary": summary}]


@pytest.mark.parametrize("blocked", [
    {"unlock_at": "2026-11-03T12:00:00Z"},
    {"lock_at": "2026-11-01T12:00:00Z"},
    {"locked_for_user": True},
    {"published": False},
    {"permissions": {"submit": False}},
    None,
    "unavailable",
])
def test_quiz_resource_availability_controls_summary_count(monkeypatch, blocked) -> None:
    requests = []

    def respond(request):
        requests.append(request)
        path = request.url.path
        if path.endswith("favorites/courses"):
            return httpx.Response(200, json=[{"id": 101, "name": "테스트 과목"}])
        if path.endswith("assignments"):
            base = {"due_at": "2026-11-03T12:00:00Z", "submission": {}}
            return httpx.Response(200, json=[
                {**base, "id": 1, "name": "아직 못 하는 퀴즈", "quiz_id": 11,
                 "submission_types": ["online_quiz"]},
                {**base, "id": 2, "name": "지금 할 수 있는 퀴즈", "quiz_id": 12,
                 "submission_types": ["online_quiz"]},
                {**base, "id": 3, "name": "미제출 과제", "submission_types": ["online_upload"]},
            ])
        if path.endswith("quizzes"):
            if blocked == "unavailable":
                return httpx.Response(403)
            quizzes = [{"id": 12, "published": True, "locked_for_user": False}]
            if blocked is not None:
                quizzes.append({"id": 11, "published": True, "locked_for_user": False, **blocked})
            return httpx.Response(200, json=quizzes)
        raise AssertionError("Only listing API resources may be read")

    original = httpx.Client
    monkeypatch.setattr(canvas.httpx, "Client", lambda **kwargs: original(
        transport=httpx.MockTransport(respond), **kwargs,
    ))
    items = canvas.read_canvas("fixture-pat", NOW, gap=0)
    count = 1 if blocked == "unavailable" else 2
    assert len(items) == count
    assert "아직 못 하는 퀴즈" not in [item.title for item in items]
    assert ("지금 할 수 있는 퀴즈" in [item.title for item in items]) == (count == 2)
    alerts, _ = plan_alerts(items, CanvasState(initialized=True), NOW, [], time(18))
    assert len(alerts) == 1 and alerts[0].title == f"내일까지 마감 {count}개가 있어요"
    assert len(requests) == 3
    assert all(request.method == "GET" and request.url.path.startswith("/api/v1/") for request in requests)


def test_quiz_match_by_assignment_id_keeps_assignment_locks() -> None:
    row = {"id": 2, "name": "퀴즈", "submission_types": ["online_quiz"],
           "due_at": "2026-11-03T12:00:00Z", "locked_for_user": True}
    quizzes = [{"id": 12, "assignment_id": 2, "published": True, "locked_for_user": False}]
    assert canvas._quiz_available(row, quizzes, NOW)
    assert canvas._assignment({"id": 101, "name": "과목"}, row, NOW) is None


def test_learningx_reservation_survives_failed_scan_without_consuming_baseline(tmp_path, monkeypatch):
    from skku_notice.canvas_alerts import load_canvas_state

    monkeypatch.setenv("CANVAS_TOKEN", "fake-token")
    monkeypatch.setattr(cli, "load_dotenv", lambda **kwargs: None)
    monkeypatch.setattr(cli, "CANVAS_STATE_PATH", tmp_path / "canvas.json")
    monkeypatch.setattr(cli, "STATE_PATH", tmp_path / "seen.json")
    monkeypatch.setattr(cli, "ARCHIVE_PATH", tmp_path / "archive.json")
    monkeypatch.setenv("NOTIFY_URLS", "ntfys://fake-topic")
    attempts = []
    clock = [NOW]

    class ScanClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return clock[0].astimezone(tz)

    monkeypatch.setattr(cli, "datetime", ScanClock)

    def fail_scan(*args, reserve_learningx, on_incomplete):
        clock[0] += timedelta(minutes=20)  # School collection precedes the actual launch.
        attempts.append(reserve_learningx())
        raise canvas.CanvasError("확인용 연결 실패")

    monkeypatch.setattr(cli, "read_canvas", fail_scan)
    args = argparse.Namespace(rules=Path("config/rules.example.yaml"), dry_run=False,
                              all=False, from_fixtures=True, no_ai=True, no_canvas=False, export=None)
    assert cli.run(args) == 1
    state = load_canvas_state(cli.CANVAS_STATE_PATH)
    assert state.last_learningx_launch == (NOW + timedelta(minutes=20)).isoformat()
    assert not state.initialized
    # Even a crash after reservation cannot trigger a second launch within the hour.
    os.utime(cli.CANVAS_STATE_PATH, (0, 0))
    assert cli.run(args) == 1
    assert attempts == [True, False]


@pytest.mark.parametrize("completed, expected", [
    (False, True), (0, True), ("false", True), ("incomplete", True),
    (True, False), (1, False), ("completed", False),
    (None, False), ("unknown", False), (2, False),
])
def test_lecture_requires_explicit_incomplete_state(completed, expected):
    row = {"id": 1, "title": "강의", "completed": completed,
           "content_data": {"use_attendance": True, "due_at": "2026-11-03T12:00:00Z"}}
    assert bool(canvas._lecture({"id": 101, "name": "과목"}, row, NOW)) == expected
    row["published"] = False
    assert canvas._lecture({"id": 101, "name": "과목"}, row, NOW) is None


def test_daily_summary_is_sent_even_when_no_tasks():
    now = NOW.replace(hour=18, minute=0)
    alerts, _ = plan_alerts([], CanvasState(initialized=True), now, [], time(18))
    assert len(alerts) == 1
    assert alerts[0].title == "내일까지 마감이 없어요"
    assert alerts[0].summary_day == now.date().isoformat()
    state = mark_sent(CanvasState(initialized=True), alerts[0], now)
    assert plan_alerts([], state, now + timedelta(minutes=1), [], time(18))[0] == []


def test_summary_waits_until_the_selected_time():
    now = NOW.replace(hour=17, minute=59)
    assert plan_alerts([], CanvasState(initialized=True), now, [], time(18))[0] == []
    assert plan_alerts([], CanvasState(initialized=True), now + timedelta(minutes=1), [], time(18))[0]


def test_incomplete_empty_scan_retries_daily_summary(tmp_path, monkeypatch):
    now = NOW.replace(hour=18)

    class FixedClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return now.astimezone(tz)

    monkeypatch.setattr(cli, "datetime", FixedClock)
    monkeypatch.setattr(cli, "CANVAS_STATE_PATH", tmp_path / "canvas.json")
    monkeypatch.setattr(cli, "STATE_PATH", tmp_path / "seen.json")
    monkeypatch.setattr(cli, "ARCHIVE_PATH", tmp_path / "archive.json")
    monkeypatch.setattr(cli, "load_dotenv", lambda **kwargs: None)
    monkeypatch.setenv("CANVAS_TOKEN", "fixture")
    monkeypatch.setenv("NOTIFY_URLS", "ntfys://fake-topic")
    monkeypatch.setenv("CANVAS_SUMMARY_TIME", "18:00")
    cli.save_canvas_state(cli.CANVAS_STATE_PATH, CanvasState(initialized=True))
    sent = []
    incomplete = [True]

    def incomplete_scan(*args, on_incomplete, **kwargs):
        if incomplete[0]:
            on_incomplete()
        return []

    monkeypatch.setattr(cli, "read_canvas", incomplete_scan)
    monkeypatch.setattr(cli, "send_canvas",
                        lambda title, body, *args, **kwargs: sent.append((title, body)) or True)
    args = argparse.Namespace(rules=Path("config/rules.example.yaml"), dry_run=False, all=False,
                              from_fixtures=True, no_ai=True, no_canvas=False, export=None)
    assert cli.run(args) == 0
    assert sent and "확인하지 못했어요" in sent[0][0]
    state = json.loads(cli.CANVAS_STATE_PATH.read_text())
    assert state["summary_sent_on"] is None
    assert state["partial_summary_sent_on"] == now.date().isoformat()
    assert cli.run(args) == 0
    assert len(sent) == 1
    incomplete[0] = False
    assert cli.run(args) == 0
    assert len(sent) == 2 and sent[1][0] == "내일까지 마감이 없어요"
    assert json.loads(cli.CANVAS_STATE_PATH.read_text())["summary_sent_on"] == now.date().isoformat()


def test_daily_summary_includes_upcoming_task_titles():
    items = canvas.read_canvas("", NOW, FIXTURES)
    alerts, _ = plan_alerts(items, CanvasState(initialized=True), NOW, [], time(18))
    summary = next(alert for alert in alerts if alert.summary_day)
    assert items[0].title in summary.body
    assert items[1].title in summary.body
