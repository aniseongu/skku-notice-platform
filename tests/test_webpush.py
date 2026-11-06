import argparse
import base64
import json
from datetime import date
from pathlib import Path

import pytest
from py_vapid import Vapid
from pywebpush import WebPushException
from requests.exceptions import ReadTimeout

from skku_notice import cli, notify, webpush_notify
from skku_notice.model import Notice


@pytest.fixture(autouse=True)
def clean_notification_config(monkeypatch):
    slots = tuple(f"WEB_PUSH_SUB_{index}" for index in range(1, 9))
    for name in ("NOTIFY_URLS", "WEB_PUSH_SUBSCRIPTION", "WEB_PUSH_PRIVATE_KEY", "WEB_PUSH_SUBJECT", *slots):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def browser_config(monkeypatch):
    vapid = Vapid()
    vapid.generate_keys()
    private = vapid.private_key.private_numbers().private_value.to_bytes(32, "big")
    subscription = {
        "endpoint": "https://fcm.googleapis.com/fcm/send/placeholder-subscription",
        "keys": {
            "p256dh": base64.urlsafe_b64encode(b"\x04" + b"p" * 64).decode().rstrip("="),
            "auth": base64.urlsafe_b64encode(b"a" * 16).decode().rstrip("="),
        },
    }
    monkeypatch.setenv("WEB_PUSH_SUBSCRIPTION", json.dumps(subscription))
    monkeypatch.setenv("WEB_PUSH_PRIVATE_KEY", base64.urlsafe_b64encode(private).decode().rstrip("="))
    return subscription


@pytest.fixture
def notice():
    return Notice("cse-notice", "123", "인턴 모집", "채용", "https://cse.skku.edu/cse/notice.do?articleNo=123",
                  date(2026, 11, 2), False)


def test_direct_browser_push_without_ntfy(monkeypatch, browser_config, notice):
    sent = []
    monkeypatch.setattr(webpush_notify, "webpush", lambda **kwargs: sent.append(kwargs))
    assert notify.has_notification_channel()
    assert notify.send_notice(notice, "소프트웨어학과", "low", None, None)
    assert len(sent) == 1
    call = sent[0]
    assert call["subscription_info"] == browser_config
    assert call["timeout"] == 10 and call["ttl"] == 86400
    payload = json.loads(call["data"])
    assert payload == {
        "title": "[소프트웨어학과] 인턴 모집", "body": "새 공지", "url": notice.url,
        "tag": "notice:cse-notice/123", "silent": True,
    }


def test_canvas_push_remains_private_and_has_click_url(monkeypatch, browser_config):
    monkeypatch.setenv("WEB_PUSH_SUB_1", json.dumps({
        **browser_config, "preferences": {"canvas": "reminders"},
    }))
    sent = []
    monkeypatch.setattr(webpush_notify, "webpush", lambda **kwargs: sent.append(json.loads(kwargs["data"])))
    assert notify.send_canvas("과제 마감", "비공개 강의", "https://canvas.skku.edu/courses/1", "high")
    assert sent[0]["url"] == "https://canvas.skku.edu/courses/1"
    assert not sent[0]["silent"]
    assert sent[0]["tag"].startswith("canvas:")
    assert "비공개" not in sent[0]["tag"]


@pytest.mark.parametrize("apprise_success,push_success", [(True, False), (False, True), (True, True)])
def test_every_configured_channel_is_attempted(
    monkeypatch, browser_config, notice, apprise_success, push_success,
):
    calls = []
    monkeypatch.setenv("NOTIFY_URLS", "ntfys://placeholder-topic")

    class FakeApprise:
        def add(self, url):
            return True

        def notify(self, **kwargs):
            calls.append("apprise")
            return apprise_success

    def push(**kwargs):
        calls.append("push")
        if not push_success:
            raise WebPushException("private provider response must not reach logs")

    monkeypatch.setattr(notify.apprise, "Apprise", FakeApprise)
    monkeypatch.setattr(webpush_notify, "webpush", push)
    assert notify.send_notice(notice, "학과", "default", None, None) == (apprise_success and push_success)
    assert calls == ["apprise", "push"]


def test_failed_provider_response_is_not_logged(monkeypatch, browser_config, capsys):
    def fail(**kwargs):
        raise WebPushException("SECRET_ENDPOINT_AND_RESPONSE")

    monkeypatch.setattr(webpush_notify, "webpush", fail)
    assert not webpush_notify.send_web_push("제목", "본문", "https://www.skku.edu", "test", "default")
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err.strip() == "웹 푸시 실패: HTTP 응답 없음"
    assert "SECRET" not in captured.err


def test_no_notification_channel(monkeypatch, notice):
    assert not notify.has_notification_channel()
    assert not notify.send_notice(notice, "학과", "default", None, None)
    assert notify.send_canvas("제목", "본문", "https://canvas.skku.edu", "default")


@pytest.mark.parametrize("endpoint", [
    "http://fcm.googleapis.com/send/key", "https://127.0.0.1/push", "https://[::1]/push",
    "https://192.168.1.1/push", "https://localhost/push", "https://host.local/push",
    "https://user:password@fcm.googleapis.com/push", "https://fcm.googleapis.com:8443/push",
])
def test_non_public_push_endpoint_rejected(monkeypatch, browser_config, endpoint):
    monkeypatch.setenv("WEB_PUSH_SUBSCRIPTION", json.dumps({**browser_config, "endpoint": endpoint}))
    with pytest.raises(ValueError, match="웹 푸시 구독 정보나 발송 키가 맞지 않아요"):
        notify.has_notification_channel()


def test_invalid_or_partial_push_config_stops_cli_before_state(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(cli, "load_dotenv", lambda **kwargs: None)
    monkeypatch.setattr(cli, "load_state", lambda *args: pytest.fail("state was read"))
    args = argparse.Namespace(rules=Path("config/rules.example.yaml"), dry_run=False, all=False)
    monkeypatch.setenv("NOTIFY_URLS", "ntfys://placeholder-topic")
    monkeypatch.setenv("WEB_PUSH_SUBSCRIPTION", "not JSON or a secret endpoint")
    assert cli.run(args) == 2
    assert "함께 설정하세요" in capsys.readouterr().err
    monkeypatch.setenv("WEB_PUSH_PRIVATE_KEY", "private-invalid-key")
    assert cli.run(args) == 2
    error = capsys.readouterr().err
    assert "구독 정보나 발송 키" in error
    assert "private-invalid-key" not in error


def test_browser_only_cli_creates_first_baseline_without_sending(monkeypatch, tmp_path, browser_config):
    monkeypatch.setattr(cli, "load_dotenv", lambda **kwargs: None)
    monkeypatch.setattr(cli, "STATE_PATH", tmp_path / "seen.json")
    monkeypatch.setattr(cli, "ARCHIVE_PATH", tmp_path / "archive.json")
    monkeypatch.setattr(cli, "send_notice", lambda *args: pytest.fail("first run notified"))
    args = argparse.Namespace(
        rules=Path("config/rules.example.yaml"), dry_run=False, all=False, from_fixtures=True,
        no_ai=True, no_canvas=True, canvas_fixtures=None, export=None,
    )
    assert cli.run(args) == 0
    assert cli.STATE_PATH.is_file()


def test_web_push_config_is_not_in_repr(browser_config):
    config = webpush_notify.web_push_config()
    assert browser_config["endpoint"] not in repr(config)


def test_default_subject_is_accepted_by_vapid_signer(browser_config):
    # webpush를 대역으로 바꾸면 서명 단계 오류를 못 잡는다. 실제 서명기로 기본 sub를 확인한다.
    config = webpush_notify.web_push_config()
    Vapid.from_string(config.private_key).sign({"sub": config.subject, "aud": "https://fcm.googleapis.com"})


def _device(seed: bytes) -> dict:
    return {
        "endpoint": f"https://fcm.googleapis.com/fcm/send/{seed.hex()}",
        "keys": {
            "p256dh": base64.urlsafe_b64encode(b"\x04" + seed * (64 // len(seed))).decode().rstrip("="),
            "auth": base64.urlsafe_b64encode(b"a" * 16).decode().rstrip("="),
        },
    }


def test_every_connected_device_gets_one_push(monkeypatch, browser_config, notice):
    phone, pc = _device(b"ph"), _device(b"pc")
    monkeypatch.setenv("WEB_PUSH_SUB_1", json.dumps(phone))
    monkeypatch.setenv("WEB_PUSH_SUB_4", json.dumps(pc))
    # 예전 이름과 같은 기기는 한 번만 보낸다.
    monkeypatch.setenv("WEB_PUSH_SUB_8", json.dumps(browser_config))
    sent = []
    monkeypatch.setattr(
        webpush_notify, "webpush", lambda **kwargs: sent.append(kwargs["subscription_info"]["endpoint"])
    )
    assert notify.send_notice(notice, "학과", "default", None, None)
    assert sorted(sent) == sorted({phone["endpoint"], pc["endpoint"], browser_config["endpoint"]})


def test_expired_device_is_skipped_but_other_failures_retry(monkeypatch, browser_config, notice, capsys):
    other = _device(b"zz")
    monkeypatch.setenv("WEB_PUSH_SUB_2", json.dumps(other))

    class Gone:
        status_code = 410

    def expired(**kwargs):
        if kwargs["subscription_info"]["endpoint"] == other["endpoint"]:
            raise WebPushException("gone", response=Gone())

    monkeypatch.setattr(webpush_notify, "webpush", expired)
    assert notify.send_notice(notice, "학과", "default", None, None)
    assert "만료된 기기 1개" in capsys.readouterr().err

    def flaky(**kwargs):
        if kwargs["subscription_info"]["endpoint"] == other["endpoint"]:
            raise WebPushException("temporary")

    monkeypatch.setattr(webpush_notify, "webpush", flaky)
    assert not notify.send_notice(notice, "학과", "default", None, None)


def test_canvas_delivery_fails_when_all_selected_devices_expired(monkeypatch, browser_config):
    subscription = {**browser_config, "preferences": {"canvas": "reminders"}}
    monkeypatch.setenv("WEB_PUSH_SUBSCRIPTION", json.dumps(subscription))

    class Gone:
        status_code = 410

    def expired(**kwargs):
        raise WebPushException("gone", response=Gone())

    monkeypatch.setattr(webpush_notify, "webpush", expired)
    assert not notify.send_canvas("제목", "내용", "https://canvas.skku.edu/", "default", summary=True)


def test_private_key_without_devices_is_not_a_channel(monkeypatch, browser_config):
    monkeypatch.delenv("WEB_PUSH_SUBSCRIPTION")
    assert not notify.has_notification_channel()


@pytest.mark.parametrize("mode,summary,expected", [
    (None, False, 0), (None, True, 0), ("off", False, 0), ("off", True, 0),
    ("summary", False, 0), ("summary", True, 1),
    ("reminders", False, 1), ("reminders", True, 1), ("invalid", True, 0),
])
def test_canvas_delivery_obeys_each_device_preference(monkeypatch, browser_config, mode, summary, expected):
    subscription = {**browser_config}
    if mode is not None:
        subscription["preferences"] = {"canvas": mode}
    monkeypatch.setenv("WEB_PUSH_SUB_1", json.dumps(subscription))
    sent = []
    monkeypatch.setattr(webpush_notify, "webpush", lambda **kwargs: sent.append(kwargs))
    assert notify.send_canvas("알림", "본문", "https://canvas.skku.edu", "default", summary=summary)
    assert len(sent) == expected
    if sent:
        assert sent[0]["subscription_info"] == browser_config


def test_slot_preference_wins_over_legacy_and_missing_duplicate(monkeypatch, browser_config):
    monkeypatch.setenv("WEB_PUSH_SUBSCRIPTION", json.dumps({
        **browser_config, "preferences": {"canvas": "reminders"},
    }))
    monkeypatch.setenv("WEB_PUSH_SUB_1", json.dumps({
        **browser_config, "preferences": {"canvas": "off"},
    }))
    monkeypatch.setenv("WEB_PUSH_SUB_8", json.dumps(browser_config))
    sent = []
    monkeypatch.setattr(webpush_notify, "webpush", lambda **kwargs: sent.append(kwargs))
    assert notify.send_canvas("알림", "본문", "https://canvas.skku.edu", "default")
    assert sent == []


def test_phone_canvas_and_pc_school_notifications_are_independent(monkeypatch, browser_config, notice):
    monkeypatch.delenv("WEB_PUSH_SUBSCRIPTION")
    phone, pc, digest = _device(b"ph"), _device(b"pc"), _device(b"dd")
    for index, subscription, mode in ((1, phone, "reminders"), (2, pc, "off"), (3, digest, "summary")):
        monkeypatch.setenv(f"WEB_PUSH_SUB_{index}", json.dumps({
            **subscription, "preferences": {"canvas": mode},
        }))
    sent = []
    monkeypatch.setattr(webpush_notify, "webpush", lambda **kwargs: sent.append(kwargs["subscription_info"]))
    assert notify.send_canvas("마감", "본문", "https://canvas.skku.edu", "default")
    assert sent == [phone]
    sent.clear()
    assert notify.send_canvas("요약", "본문", "https://canvas.skku.edu", "default", summary=True)
    assert sent == [phone, digest]
    sent.clear()
    assert notify.send_notice(notice, "학교", "default", None, None)
    assert sent == [phone, pc, digest]


def test_selected_canvas_device_retries_temporary_failure(monkeypatch, browser_config):
    monkeypatch.setenv("WEB_PUSH_SUB_1", json.dumps({
        **browser_config, "preferences": {"canvas": "reminders"},
    }))

    def fail(**kwargs):
        raise WebPushException("private temporary failure")

    monkeypatch.setattr(webpush_notify, "webpush", fail)
    assert not notify.send_canvas("마감", "본문", "https://canvas.skku.edu", "default")


def test_timeout_retries_only_failed_device(monkeypatch, browser_config):
    other = _device(b"zz")
    monkeypatch.setenv("WEB_PUSH_SUB_2", json.dumps(other))
    calls = []

    def push(**kwargs):
        endpoint = kwargs["subscription_info"]["endpoint"]
        calls.append(endpoint)
        if endpoint == other["endpoint"] and calls.count(endpoint) == 1:
            raise ReadTimeout("SECRET_ENDPOINT")

    monkeypatch.setattr(webpush_notify, "webpush", push)
    monkeypatch.setattr(webpush_notify.time, "sleep", lambda _: None)
    assert webpush_notify.send_web_push("제목", "본문", "https://www.skku.edu", "test", "default")
    assert calls == [browser_config["endpoint"], other["endpoint"], other["endpoint"]]


def test_timeout_exhaustion_is_failure_and_hides_exception(monkeypatch, browser_config, capsys):
    calls = []

    def push(**kwargs):
        calls.append(1)
        raise ReadTimeout("SECRET_ENDPOINT")

    monkeypatch.setattr(webpush_notify, "webpush", push)
    monkeypatch.setattr(webpush_notify.time, "sleep", lambda _: None)
    assert not webpush_notify.send_web_push("제목", "본문", "https://www.skku.edu", "test", "default")
    assert len(calls) == 3
    assert "SECRET_ENDPOINT" not in capsys.readouterr().err


@pytest.mark.parametrize("status,expected_calls", [(403, 1), (410, 1), (429, 1), (503, 3)])
def test_http_push_failures_retry_only_transient(monkeypatch, browser_config, status, expected_calls):
    calls = []

    class Response:
        status_code = status

    def push(**kwargs):
        calls.append(1)
        raise WebPushException("private", response=Response())

    monkeypatch.setattr(webpush_notify, "webpush", push)
    monkeypatch.setattr(webpush_notify.time, "sleep", lambda _: None)
    assert not webpush_notify.send_web_push("제목", "본문", "https://www.skku.edu", "test", "default")
    assert len(calls) == expected_calls
