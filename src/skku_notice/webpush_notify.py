# 출처: https://github.com/web-push-libs/pywebpush/blob/main/README.md
"""Send private browser subscriptions without exposing their capability URLs."""

import base64
import ipaddress
import json
import os
import sys
import time
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from py_vapid import Vapid
from pywebpush import WebPushException, webpush
from requests.exceptions import ConnectionError, Timeout

# 기기마다 Secret 칸 하나(WEB_PUSH_SUB_1..8). 브라우저는 Secret을 읽을 수 없어 한 목록에 덧붙이지 못하므로
# 비어 있는 칸에 저장한다. Actions는 칸 이름을 하나씩 넘긴다(D-019).
DEVICE_SLOTS = tuple(f"WEB_PUSH_SUB_{index}" for index in range(1, 9))


@dataclass(frozen=True, repr=False)
class WebPushConfig:
    subscriptions: tuple[dict, ...] = field(repr=False)
    private_key: str = field(repr=False)
    subject: str


def _public_endpoint(endpoint: str) -> bool:
    try:
        url = urlsplit(endpoint)
        host = (url.hostname or "").rstrip(".").lower()
        if url.scheme != "https" or not host or url.username or url.password or url.port not in (None, 443):
            return False
        try:
            return ipaddress.ip_address(host).is_global
        except ValueError:
            return "." in host and not host.endswith((".localhost", ".local", ".internal"))
    except ValueError:
        return False


def _decode_key(value: str) -> bytes:
    return base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)


def _valid_subscription(raw: str) -> dict | None:
    try:
        subscription = json.loads(raw)
        if not isinstance(subscription, dict) or not _public_endpoint(subscription.get("endpoint", "")):
            return None
        keys = subscription["keys"]
        public = _decode_key(keys["p256dh"])
        auth = _decode_key(keys["auth"])
        if len(public) != 65 or public[0] != 4 or len(auth) != 16:
            return None
        return subscription
    except Exception:
        return None


def _raw_subscriptions() -> list[str]:
    names = ("WEB_PUSH_SUBSCRIPTION", *DEVICE_SLOTS)
    return [value for value in (os.environ.get(name, "").strip() for name in names) if value]


def web_push_config() -> WebPushConfig | None:
    """Validate before processing notices, using only safe error messages."""
    raw = _raw_subscriptions()
    private_key = os.environ.get("WEB_PUSH_PRIVATE_KEY", "").strip()
    # 연결한 기기가 없으면 웹 푸시는 쓰지 않는다(발송 키만 남아 있어도 된다).
    if not raw:
        return None
    if not private_key:
        raise ValueError("WEB_PUSH_SUBSCRIPTION과 WEB_PUSH_PRIVATE_KEY를 함께 설정하세요")
    try:
        Vapid.from_string(private_key)
    except Exception:
        # Library exceptions can contain key material.
        raise ValueError("웹 푸시 구독 정보나 발송 키가 맞지 않아요") from None
    # 같은 기기가 예전 이름(WEB_PUSH_SUBSCRIPTION)과 새 이름에 함께 있으면 한 번만 보낸다.
    unique: dict[str, dict] = {}
    invalid = 0
    for value in raw:
        subscription = _valid_subscription(value)
        if subscription:
            previous = unique.get(subscription["endpoint"])
            if previous is None or _has_canvas_preference(subscription):
                unique[subscription["endpoint"]] = subscription
        else:
            invalid += 1
    if not unique:
        raise ValueError("웹 푸시 구독 정보나 발송 키가 맞지 않아요")
    if invalid:
        print(f"웹 푸시: 쓸 수 없는 구독 {invalid}개를 건너뛰어요", file=sys.stderr)
    # py_vapid는 경로가 붙은 https 주소를 거부한다. 메일 주소는 공개 코드에 두지 않는다.
    subject = os.environ.get("WEB_PUSH_SUBJECT", "https://aniseongu.github.io").strip()
    if not subject.startswith(("https://", "mailto:")):
        raise ValueError("WEB_PUSH_SUBJECT는 https 또는 mailto 주소로 설정하세요")
    return WebPushConfig(tuple(unique.values()), private_key, subject)


def _has_canvas_preference(subscription: dict) -> bool:
    preferences = subscription.get("preferences")
    return isinstance(preferences, dict) and "canvas" in preferences


def _accepts_canvas(subscription: dict, summary: bool) -> bool:
    if not _has_canvas_preference(subscription):
        return False
    mode = subscription["preferences"]["canvas"]
    return mode == "reminders" or (mode == "summary" and summary)


def _standard_subscription(subscription: dict) -> dict:
    standard = {field: subscription[field] for field in ("endpoint", "expirationTime")
                if field in subscription}
    standard["keys"] = {field: subscription["keys"][field] for field in ("p256dh", "auth")}
    return standard


def send_web_push(
    title: str, body: str, url: str, tag: str, priority: str, *, canvas_summary: bool | None = None,
) -> bool:
    """Filter private Canvas alerts by device; ordinary notices reach every device."""
    try:
        config = web_push_config()
    except ValueError:
        return False
    if config is None:
        if canvas_summary is not None:
            print("웹 푸시: 연결된 기기가 없어 아이캠퍼스 알림을 보내지 않았어요", file=sys.stderr)
        return canvas_summary is not None
    subscriptions = [subscription for subscription in config.subscriptions
                     if canvas_summary is None or _accepts_canvas(subscription, canvas_summary)]
    if not subscriptions:
        # 기기별로 아캠 알림을 끈 경우다. 성공으로 보지만 왜 안 갔는지 로그에 남긴다.
        print("웹 푸시: 이 알림을 받도록 설정한 기기가 없어 보내지 않았어요", file=sys.stderr)
        return True
    payload = json.dumps({"title": title[:180], "body": body[:600], "url": url, "tag": tag,
                          "silent": priority == "low"}, ensure_ascii=False)
    delivered = failed = gone = 0
    for subscription in subscriptions:
        for attempt in range(3):
            try:
                webpush(
                    subscription_info=_standard_subscription(subscription),
                    data=payload,
                    vapid_private_key=config.private_key,
                    vapid_claims={"sub": config.subject},
                    timeout=10,
                    ttl=86400,
                )
                delivered += 1
                break
            except WebPushException as exc:
                # 구독 주소와 응답 본문은 비밀이다.
                status = getattr(getattr(exc, "response", None), "status_code", None)
                if status in (404, 410):
                    gone += 1
                    break
                if status in (500, 502, 503, 504) and attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                failed += 1
                print(f"웹 푸시 실패: HTTP {status or '응답 없음'}", file=sys.stderr)
                break
            except (Timeout, ConnectionError) as exc:
                if attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                failed += 1
                print(f"웹 푸시 실패: {type(exc).__name__}", file=sys.stderr)
                break
            except Exception as exc:
                # Retain pending state for the next run without logging private endpoints.
                failed += 1
                print(f"웹 푸시 실패: {type(exc).__name__}", file=sys.stderr)
                break
    if gone:
        print(f"웹 푸시: 만료된 기기 {gone}개는 설정에서 알림을 다시 켜 주세요", file=sys.stderr)
    # 한 기기라도 일시 실패면 다음 실행에 다시 보낸다(D-005, 드문 중복은 감수).
    return failed == 0 and delivered > 0
