"""Validate and send one user web-push message without logging capabilities."""

import base64
import ipaddress
import json
import socket
from urllib.parse import urlsplit

import requests
from pywebpush import WebPushException, webpush

TRUSTED_PUSH_HOSTS = frozenset({"fcm.googleapis.com", "updates.push.services.mozilla.com"})


def trusted_endpoint(endpoint: str) -> bool:
    try:
        url = urlsplit(endpoint)
        host = (url.hostname or "").lower()
        apple = host.endswith(".push.apple.com") and host.count(".") == 3
        if (
            url.scheme != "https"
            or not (host in TRUSTED_PUSH_HOSTS or apple)
            or url.username
            or url.password
            or url.port not in (None, 443)
            or not url.path
            or url.fragment
        ):
            return False
        addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        return bool(addresses) and all(ipaddress.ip_address(item[4][0]).is_global for item in addresses)
    except (ValueError, OSError):
        return False


def _decode(value: str) -> bytes:
    return base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)


def valid_subscription(subscription: dict) -> bool:
    try:
        public = _decode(subscription["keys"]["p256dh"])
        auth = _decode(subscription["keys"]["auth"])
        return (
            len(public) == 65
            and public[0] == 4
            and len(auth) == 16
            and trusted_endpoint(subscription["endpoint"])
        )
    except (KeyError, TypeError, ValueError):
        return False


class NoRedirectSession(requests.Session):
    def request(self, method, url, **kwargs):
        kwargs["allow_redirects"] = False
        return super().request(method, url, **kwargs)


def send_one(subscription: dict, private_key: str, subject: str, *, title: str, url: str, tag: str) -> str:
    """Return sent, expired or retry; never log endpoints, keys or response bodies."""
    if not valid_subscription(subscription):
        # DNS failures are indistinguishable here from invalid endpoints; never delete on uncertainty.
        return "retry"
    payload = json.dumps(
        {"title": title[:180], "body": "새 공지가 도착했어요", "url": url, "tag": tag}, ensure_ascii=False
    )
    try:
        with NoRedirectSession() as session:
            response = webpush(
                subscription_info=subscription,
                data=payload,
                vapid_private_key=private_key,
                vapid_claims={"sub": subject},
                ttl=3600,
                timeout=10,
                requests_session=session,
            )
        if not isinstance(response, requests.Response):
            return "retry"
        if 200 <= response.status_code < 300:
            return "sent"
        return "expired" if response.status_code in (404, 410) else "retry"
    except WebPushException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        return "expired" if status in (404, 410) else "retry"
    except Exception:
        return "retry"
