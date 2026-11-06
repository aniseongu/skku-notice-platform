import httpx
import pytest

from skku_notice.learningx import LearningXError, LearningXSession

BASE = "https://canvas.skku.edu"
COURSES = [{"id": 101, "name": "private-course"}]


def setup_flow(*, launch_url=None, action=None, redirect=None):
    pat_requests, session_requests = [], []

    def canvas_response(request):
        pat_requests.append(request)
        if request.url.path.endswith("/tabs"):
            return httpx.Response(200, json=[
                {"id": "context_external_tool_8", "label": "강의콘텐츠 (구)"},
                {"id": "context_external_tool_9", "label": "강의콘텐츠"},
            ])
        return httpx.Response(200, json={
            "url": launch_url or BASE + "/courses/101/external_tools/sessionless_launch?verifier=secret",
        })

    def session_response(request):
        session_requests.append(request)
        if request.url.path in {"/courses/101/external_tools/9",
                                "/courses/101/external_tools/sessionless_launch"}:
            target = action or BASE + "/learningx/lti"
            return httpx.Response(200, text=f'<form method="POST" action="{target}">'
                                  '<input type="hidden" name="oauth_signature" value="secret-signature">'
                                  '</form>')
        if request.method == "POST":
            if redirect:
                return httpx.Response(302, headers={"Location": redirect})
            return httpx.Response(302, headers={
                "Location": "https://unrelated.example/never-follow",
                "Set-Cookie": "xn_api_token=temporary-secret; Path=/; Secure; HttpOnly",
            })
        if request.url.path.endswith("/modules"):
            return httpx.Response(200, json=[{"module_items": [{"id": 12}]}])
        raise AssertionError("Unexpected network request")

    pat = httpx.Client(headers={"Authorization": "Bearer private-pat"},
                       transport=httpx.MockTransport(canvas_response), follow_redirects=False)
    session = LearningXSession(httpx.Client(transport=httpx.MockTransport(session_response),
                                           follow_redirects=False))
    return pat, session, pat_requests, session_requests


def test_temporary_auth_is_isolated_and_no_landing_or_video_is_requested():
    pat, session, pat_requests, session_requests = setup_flow()
    try:
        assert session.authenticate(pat, COURSES, 0)
        assert session.read_modules("101", 0) == [{"module_items": [{"id": 12}]}]
        assert all(request.headers["authorization"] == "Bearer private-pat" for request in pat_requests)
        assert all("authorization" not in request.headers for request in session_requests[:2])
        assert session_requests[2].headers["authorization"] == "Bearer temporary-secret"
        assert len(session_requests) == 3
        assert not pat.cookies
        assert str(pat_requests[1].url).endswith("sessionless_launch?id=9")
    finally:
        pat.close()
        session.close()
    assert session._token is None and not session.client.cookies


@pytest.mark.parametrize("launch_url", [
    "https://evil.example/courses/101/external_tools/9?secret=x",
    "https://canvas.skku.edu@evil.example/courses/101/external_tools/9",
    BASE + "/courses/101/quizzes/9",
    BASE + "/courses/101/modules/items/9",
    BASE + "/login?secret=x",
    BASE + "/courses/102/external_tools/9",
])
def test_bad_signed_launch_never_receives_a_request_or_leaks_url(launch_url):
    pat, session, _, session_requests = setup_flow(launch_url=launch_url)
    try:
        with pytest.raises(LearningXError) as exc:
            session.authenticate(pat, COURSES, 0)
        assert not session_requests
        assert "secret" not in str(exc.value) and "https" not in str(exc.value)
    finally:
        pat.close()
        session.close()


@pytest.mark.parametrize("action", [
    "https://evil.example/learningx/lti", BASE + "/login", BASE + "/learningx/videos/12",
    BASE + "/learningx/quiz/12", BASE + "/learningx/api/v1/courses/101/modules",
])
def test_unsafe_form_action_never_receives_private_lti_form(action):
    pat, session, _, requests = setup_flow(action=action)
    try:
        with pytest.raises(LearningXError):
            session.authenticate(pat, COURSES, 0)
        assert len(requests) == 1
    finally:
        pat.close()
        session.close()


@pytest.mark.parametrize("redirect", [
    "https://evil.example/learningx/lti", BASE + "/login", BASE + "/learningx/videos/12",
    BASE + "/courses/101/modules/items/12", BASE + "/learningx/quiz/12",
])
def test_auth_redirect_cannot_open_content_or_login(redirect):
    pat, session, _, requests = setup_flow(redirect=redirect)
    try:
        with pytest.raises(LearningXError):
            session.authenticate(pat, COURSES, 0)
        assert len(requests) == 2
    finally:
        pat.close()
        session.close()


def test_empty_favorites_never_launch_or_fallback_to_all_courses():
    pat, session, requests, session_requests = setup_flow()
    try:
        assert session.authenticate(pat, [], 0) is False
        assert not requests and not session_requests
        with pytest.raises(LearningXError):
            session.read_modules("101", 0)
    finally:
        pat.close()
        session.close()


def test_module_pagination_does_not_send_token_to_other_resource():
    requests = []

    def response(request):
        requests.append(request)
        return httpx.Response(200, json=[], headers={
            "Link": '<https://evil.example/steal>; rel="next"',
        })

    session = LearningXSession(httpx.Client(transport=httpx.MockTransport(response)))
    session._token = "ephemeral"
    try:
        with pytest.raises(LearningXError):
            session.read_modules("101", 0)
        assert len(requests) == 1
    finally:
        session.close()


def test_missing_current_tool_never_creates_a_signed_launch():
    requests = []

    def tabs(request):
        requests.append(request)
        return httpx.Response(200, json=[{"id": "context_external_tool_8", "label": "강의콘텐츠 (구)"}])

    pat = httpx.Client(transport=httpx.MockTransport(tabs))
    session = LearningXSession()
    try:
        assert session.authenticate(pat, COURSES, 0) is False
        assert len(requests) == 1
    finally:
        pat.close()
        session.close()


def test_launch_session_cookie_redirect_only_follows_same_selected_tool():
    pat, original_session, _, _ = setup_flow()
    original_session.close()
    requests = []

    def respond(request):
        requests.append(request)
        if request.method == "POST":
            return httpx.Response(200, headers={"Set-Cookie": "xn_api_token=token; Path=/; Secure"})
        if "session_token" in request.url.params:
            return httpx.Response(302, headers={
                "Location": "/courses/101/external_tools/9",
                "Set-Cookie": "canvas_session=isolated; Path=/; Secure",
            })
        return httpx.Response(200, text='<form method="post" action="/learningx/lti/modulebuilder">'
                              '<input type="hidden" name="oauth_signature" value="private"></form>')

    session = LearningXSession(httpx.Client(transport=httpx.MockTransport(respond)))
    original_send = pat.send

    def patched_send(request, **kwargs):
        response = original_send(request, **kwargs)
        if request.url.path.endswith("sessionless_launch"):
            return httpx.Response(200, json={
                "url": BASE + "/courses/101/external_tools/9?session_token=isolated-token",
            }, request=request)
        return response

    pat.send = patched_send
    try:
        assert session.authenticate(pat, COURSES, 0)
        assert len(requests) == 3
        assert "canvas_session=isolated" in requests[1].headers.get("cookie", "")
        assert not pat.cookies
    finally:
        pat.close()
        session.close()


@pytest.mark.parametrize("label", ["Lecture Contents", "Modules", "Module", "주차 학습", "강의 콘텐츠"])
def test_selects_current_tool_from_next_favorite_with_only_one_launch(monkeypatch, label):
    requests, sleeps, session_requests = [], [], []
    monkeypatch.setattr("skku_notice.learningx.time.sleep", sleeps.append)

    def canvas_response(request):
        requests.append(request)
        if request.url.path.endswith("/tabs"):
            assert request.url.params["include[]"] == "external"
            if "/101/" in request.url.path:
                return httpx.Response(200, json=[
                    {"id": "context_external_tool_9", "label": "(Old) Lecture Contents"},
                    {"id": "context_external_tool_8", "label": "(구) 강의콘텐츠"},
                ])
            return httpx.Response(200, json=[{"id": "context_external_tool_10", "label": label}])
        assert request.url.path == "/api/v1/courses/102/external_tools/sessionless_launch"
        return httpx.Response(200, json={
            "url": BASE + "/courses/102/external_tools/10?session_token=private",
        })

    def session_response(request):
        session_requests.append(request)
        if request.method == "GET":
            return httpx.Response(200, text='<form method="post" action="/learningx/lti">'
                                  '<input type="hidden" name="signature" value="secret"></form>')
        return httpx.Response(200, headers={"Set-Cookie": "xn_api_token=temporary; Path=/; Secure"})

    pat = httpx.Client(transport=httpx.MockTransport(canvas_response))
    session = LearningXSession(httpx.Client(transport=httpx.MockTransport(session_response)))
    try:
        courses = [*COURSES, {"id": 102, "name": "second"}, {"id": 103, "name": "third"}]
        assert session.authenticate(pat, courses, 1.5)
        assert [request.url.path for request in requests] == [
            "/api/v1/courses/101/tabs", "/api/v1/courses/102/tabs",
            "/api/v1/courses/102/external_tools/sessionless_launch",
        ]
        assert sleeps == [1.5, 1.5]
        assert len(session_requests) == 2
    finally:
        pat.close()
        session.close()
