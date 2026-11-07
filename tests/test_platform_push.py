import base64
import socket

import requests

from skku_notice import platform_push as push


def encode(data):
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def subscription(endpoint="https://fcm.googleapis.com/fcm/send/example"):
    return {"endpoint": endpoint, "keys": {"p256dh": encode(b"\x04" + b"a" * 64), "auth": encode(b"b" * 16)}}


def test_endpoint_allowlist_blocks_private_or_untrusted_destinations(monkeypatch):
    monkeypatch.setattr(
        push.socket,
        "getaddrinfo",
        lambda *_args, **_kw: [(socket.AF_INET, None, None, None, ("8.8.8.8", 443))],
    )
    assert push.valid_subscription(subscription())
    for url in [
        "https://attacker.invalid/x",
        "http://fcm.googleapis.com/x",
        "https://fcm.googleapis.com.attacker.invalid/x",
        "https://127.0.0.1/x",
        "https://fcm.googleapis.com:444/x",
        "https://fcm.googleapis.com/x#fragment",
    ]:
        assert not push.valid_subscription(subscription(url))
    monkeypatch.setattr(
        push.socket,
        "getaddrinfo",
        lambda *_args, **_kw: [(socket.AF_INET, None, None, None, ("127.0.0.1", 443))],
    )
    assert not push.valid_subscription(subscription())


def test_push_outcomes_do_not_expose_endpoint_or_send_on_invalid_input(monkeypatch):
    monkeypatch.setattr(
        push, "trusted_endpoint", lambda endpoint: endpoint.startswith("https://fcm.googleapis.com/")
    )
    calls = []

    def send(**kwargs):
        calls.append(kwargs)
        response = requests.Response()
        response.status_code = 201
        return response

    monkeypatch.setattr(push, "webpush", send)
    assert (
        push.send_one(
            subscription(),
            "private",
            "mailto:test@example.invalid",
            title="공지",
            url="https://www.skku.edu/",
            tag="notice",
        )
        == "sent"
    )
    assert calls[0]["requests_session"].__class__ is push.NoRedirectSession
    assert (
        push.send_one(
            subscription("https://bad.invalid/"),
            "private",
            "mailto:test@example.invalid",
            title="공지",
            url="https://www.skku.edu/",
            tag="notice",
        )
        == "retry"
    )
    assert len(calls) == 1


def test_no_redirect_session_forces_redirects_off(monkeypatch):
    captured = {}
    monkeypatch.setattr(requests.Session, "request", lambda self, method, url, **kw: captured.update(kw))
    with push.NoRedirectSession() as session:
        session.request("POST", "https://fcm.googleapis.com/path", allow_redirects=True)
    assert captured["allow_redirects"] is False


def test_expired_push_service_response_is_distinct_from_temporary_failure(monkeypatch):
    monkeypatch.setattr(push, "trusted_endpoint", lambda _endpoint: True)
    response = requests.Response()
    response.status_code = 410

    def expired(**_kwargs):
        raise push.WebPushException("private response must not be logged", response=response)

    monkeypatch.setattr(push, "webpush", expired)
    assert (
        push.send_one(
            subscription(),
            "private",
            "mailto:test@example.invalid",
            title="공지",
            url="https://www.skku.edu/",
            tag="notice",
        )
        == "expired"
    )
