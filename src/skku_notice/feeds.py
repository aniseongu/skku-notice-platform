# 출처: https://github.com/hg111911190-sketch/skku-notice/blob/main/jobs.py (ics_text)
"""Public deadline calendar (deadlines.ics) and RSS feed (feed.xml) for the static site."""

import os
from datetime import UTC, datetime, timedelta
from email.utils import format_datetime
from xml.sax.saxutils import escape

from skku_notice.deadline import KST

SITE_URL = os.environ.get("SITE_URL", "https://aniseongu.github.io/skku-notice-alert/")
FEED_LIMIT = 50


def _ics_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line: str) -> str:
    # RFC 5545는 75바이트마다 줄을 접는다. 한글 한 글자가 잘리지 않게 글자 단위로 센다.
    out, current = [], ""
    for char in line:
        if len((current + char).encode("utf-8")) > 74:
            out.append(current)
            current = " "
        current += char
    return "\r\n".join([*out, current])


def deadlines_ics(notices: list[dict], board_names: dict[str, str], now: datetime) -> str:
    """One all-day event per notice deadline, so calendar apps can subscribe to it."""
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//skku-notice-alert//deadlines//KO", "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH", "X-WR-CALNAME:성공 마감", "X-WR-TIMEZONE:Asia/Seoul",
        "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
    ]
    stamp = now.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
    for notice in notices:
        if not notice.get("deadline"):
            continue
        deadline = datetime.fromisoformat(notice["deadline"]).astimezone(KST)
        if deadline <= now:
            continue
        day = deadline.date()
        # 마감 시각이 적힌 글만 시각을 붙인다. 날짜만 있으면 23:59로 저장돼 있다(deadline.py).
        time = "" if (deadline.hour, deadline.minute) == (23, 59) else f" {deadline:%H:%M}"
        board = board_names.get(notice["source_id"], notice["source_id"])
        description = f"{board}\n{notice.get('deadline_kind') or '마감'}{time}\n{notice['url']}"
        lines += [
            "BEGIN:VEVENT", f"UID:{notice['id']}@skku-notice-alert", f"DTSTAMP:{stamp}",
            f"DTSTART;VALUE=DATE:{day:%Y%m%d}", f"DTEND;VALUE=DATE:{day + timedelta(days=1):%Y%m%d}",
            "SUMMARY:" + _ics_escape(notice["title"]),
            "DESCRIPTION:" + _ics_escape(description),
            "URL:" + notice["url"], "TRANSP:TRANSPARENT", "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"


def rss_feed(notices: list[dict], board_names: dict[str, str], now: datetime) -> str:
    """Newest notices as RSS 2.0 for feed readers."""
    items = []
    for notice in notices[:FEED_LIMIT]:
        seen = notice.get("first_seen")
        posted = datetime.fromisoformat(notice["posted_on"]).replace(tzinfo=KST)
        published = datetime.fromisoformat(seen) if seen else posted
        board = board_names.get(notice["source_id"], notice["source_id"])
        detail = ", ".join(filter(None, [board, notice.get("category")]))
        items.append(
            "<item>"
            f"<title>{escape(f'[{board}] {notice['title']}')}</title>"
            f"<link>{escape(notice['url'])}</link>"
            f'<guid isPermaLink="false">{escape(notice["id"])}</guid>'
            f"<pubDate>{format_datetime(published)}</pubDate>"
            f"<description>{escape(detail)}</description>"
            "</item>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>'
        f"<title>성공</title><link>{escape(SITE_URL)}</link>"
        "<description>성균관대 공지 게시판 새 글</description><language>ko</language>"
        f"<lastBuildDate>{format_datetime(now)}</lastBuildDate>{''.join(items)}</channel></rss>\n"
    )
