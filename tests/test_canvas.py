from dataclasses import replace
from datetime import datetime, time, timedelta
from pathlib import Path

import httpx
import pytest

from skku_notice import canvas
from skku_notice.canvas_alerts import CanvasState, mark_sent, plan_alerts
from skku_notice.deadline import KST

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









def test_summary_mode_never_plans_individual_reminders() -> None:
    items = canvas.read_canvas("", NOW, FIXTURES)
    alerts, _ = plan_alerts(items, CanvasState(initialized=True), NOW, [], time(9))
    assert len(alerts) == 1
    assert alerts[0].summary_day
    assert not alerts[0].keys






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
    # 퀴즈 목록 API를 쓸 수 없으면(403·404) 아이캠퍼스 플러스처럼 과제 필드만 보므로 세 개가 모두 남는다.
    count = 3 if blocked == "unavailable" else 2
    assert len(items) == count
    assert ("아직 못 하는 퀴즈" in [item.title for item in items]) == (blocked == "unavailable")
    assert "지금 할 수 있는 퀴즈" in [item.title for item in items]
    alerts, _ = plan_alerts(items, CanvasState(initialized=True), NOW, [], time(18))
    assert len(alerts) == 1 and alerts[0].title == f"내일까지 마감 {count}개가 있어요"
    assert len(requests) == 3
    assert all(request.method == "GET" and request.url.path.startswith("/api/v1/") for request in requests)


def test_missing_quiz_api_is_not_reported_as_incomplete(capsys) -> None:
    """HTTP 404 on /quizzes is permanent for that course; it must not trigger the incomplete warning."""
    class Lectures:
        def read_modules(self, course_id, gap):
            return []

    def get(path):
        if path.endswith("quizzes?per_page=100"):
            raise canvas.CanvasError("Canvas HTTP 404")
        return [{"id": 1, "name": "새 퀴즈", "due_at": "2026-11-03T12:00:00Z", "submission": {},
                 "submission_types": ["external_tool"], "is_quiz_assignment": True}]

    incomplete = []
    items = canvas._read_courses([{"id": 101, "name": "테스트 과목"}], NOW, get, 0, True, Lectures(),
                                 lambda: incomplete.append(True))
    assert [item.title for item in items] == ["새 퀴즈"] and items[0].kind == "퀴즈"
    assert incomplete == []
    assert "퀴즈 조회 대기" not in capsys.readouterr().err

    def flaky(path):
        if path.endswith("quizzes?per_page=100"):
            raise canvas.CanvasError("Canvas HTTP 500")
        return get("assignments")

    items = canvas._read_courses([{"id": 101, "name": "테스트 과목"}], NOW, flaky, 0, True, Lectures(),
                                 lambda: incomplete.append(True))
    assert items == [] and incomplete == [True]  # 일시적인 오류는 계속 불완전로 알린다
    assert "퀴즈 조회 대기: Canvas HTTP 500" in capsys.readouterr().err


def test_quiz_match_by_assignment_id_keeps_assignment_locks() -> None:
    row = {"id": 2, "name": "퀴즈", "submission_types": ["online_quiz"],
           "due_at": "2026-11-03T12:00:00Z", "locked_for_user": True}
    quizzes = [{"id": 12, "assignment_id": 2, "published": True, "locked_for_user": False}]
    assert canvas._quiz_available(row, quizzes, NOW)
    assert canvas._assignment({"id": 101, "name": "과목"}, row, NOW) is None




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




def test_daily_summary_includes_upcoming_task_titles():
    items = canvas.read_canvas("", NOW, FIXTURES)
    alerts, _ = plan_alerts(items, CanvasState(initialized=True), NOW, [], time(18))
    summary = next(alert for alert in alerts if alert.summary_day)
    assert items[0].title in summary.body
    assert items[1].title in summary.body


def test_problem_alert_is_made_once_for_a_rejected_token():
    """토큰이 거절돼 연결이 끊겼을 때만, 아직 알리지 않았다면 한 번 알린다(서버 워커가 쓴다)."""
    from skku_notice.canvas_alerts import CanvasState, problem_alert

    assert problem_alert(CanvasState()) is None
    alert = problem_alert(CanvasState(problem={"kind": "rejected"}))
    assert alert is not None and "연결이 끊겼어요" in alert.title and alert.priority == "high"
    assert problem_alert(CanvasState(problem={"kind": "rejected", "notifiedProblem": True})) is None
