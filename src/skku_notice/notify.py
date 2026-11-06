"""Send notice notifications through Apprise and direct browser Web Push."""

import hashlib
import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import apprise

from skku_notice.deadline import KST, extract_deadline
from skku_notice.model import Match, Notice
from skku_notice.webpush_notify import send_web_push, web_push_config

PRIORITIES = {"high": "4", "default": "3", "low": "2"}


def has_notification_channel() -> bool:
    push = web_push_config()
    return bool(push or any(value.strip() for value in os.environ.get("NOTIFY_URLS", "").split(",")))


def _url_for_notice(url: str, notice: Notice, priority: str) -> str:
    if urlsplit(url).scheme not in {"ntfy", "ntfys"}:
        return url
    parts = urlsplit(url)
    query = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if key not in {"click", "priority"}
    ]
    query.extend((("click", notice.url), ("priority", PRIORITIES[priority])))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def send_notice(
    notice: Notice, source_name: str, priority: str, match: Match | None, ai_reason: str | None,
    interests: tuple[str, ...] = (),
) -> bool:
    body = []
    if interests:
        body.append(f"관심 {', '.join(interests)}")
    if ai_reason:
        body.append(ai_reason)
    deadline = extract_deadline(notice.title, notice.posted_on)
    if deadline:
        local = deadline.astimezone(KST)
        weekday = "월화수목금토일"[local.weekday()]
        label = f"마감 {local.month}월 {local.day}일({weekday})"
        if (local.hour, local.minute) != (23, 59):
            label += f" {local:%H:%M}"
        body.append(label)
    if match:
        body.append(f"{match.rule_name} 기준에 맞아요")
    urls = [value.strip() for value in os.environ.get("NOTIFY_URLS", "").split(",") if value.strip()]
    return _deliver(
        f"[{source_name}] {notice.title}", "\n".join(body) or "새 공지", notice.url,
        f"notice:{notice.source_id}/{notice.article_no}", priority,
        [_url_for_notice(url, notice, priority) for url in urls],
    )


def _deliver(
    title: str, body: str, click_url: str, tag: str, priority: str, urls: list[str], *,
    canvas_summary: bool | None = None,
) -> bool:
    results = []
    if urls:
        try:
            sender = apprise.Apprise()
            added = [sender.add(url) for url in urls]
            delivered = bool(sender.notify(title=title, body=body)) if any(added) else False
            results.append(all(added) and delivered)
        except Exception:
            results.append(False)
    try:
        push = web_push_config() is not None
    except ValueError:
        push = True  # 설정이 틀리면 보내기에서 실패로 돌려 다음 실행에 다시 시도한다.
    if push or canvas_summary is not None:
        results.append(send_web_push(title, body, click_url, tag, priority, canvas_summary=canvas_summary))
    return bool(results) and all(results)


def send_canvas(title: str, body: str, click_url: str, priority: str, *, summary: bool = False) -> bool:
    """Send one private Canvas alert using the configured notification channels."""
    urls = [value.strip() for value in os.environ.get("NOTIFY_URLS", "").split(",") if value.strip()]
    prepared = []
    for url in urls:
        parts = urlsplit(url)
        if parts.scheme in {"ntfy", "ntfys"}:
            query = [
                (key, value)
                for key, value in parse_qsl(parts.query)
                if key not in {"click", "priority", "tags"}
            ]
            query.extend((("click", click_url), ("priority", PRIORITIES[priority]), ("tags", "alarm")))
            url = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
        prepared.append(url)
    tag = "canvas:" + hashlib.sha256(f"{title}\n{body}\n{click_url}".encode()).hexdigest()[:24]
    return _deliver(title, body, click_url, tag, priority, prepared, canvas_summary=summary)
