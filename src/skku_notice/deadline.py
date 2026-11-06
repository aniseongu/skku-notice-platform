# 출처: https://github.com/tsungmnli/skku-notice-api/blob/main/app/crawler/deadline.py
"""Extract marked application deadlines from titles."""

import re
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
DATE_RE = re.compile(
    r"(?<!\d)(?:(?P<year>20\d{2})\s*(?:[./-]|년)\s*)?"
    r"(?P<month>\d{1,2})\s*(?:[./-]|월)\s*(?P<day>\d{1,2})(?!\d)\s*(?:일|\.)?"
    r"(?:\s*\([월화수목금토일]\))?"
)
AFTER_RE = re.compile(
    r"^\s*(?:\([월화수목금토일]\))?"
    r"(?:\s*(?:오전|오후)?\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?)?\s*(?:까지|마감)"
)
BEFORE_RE = re.compile(r"(?:마감(?:일|기한)?\s*[:：]?\s*|[~∼～]\s*)$")
TIME_RE = re.compile(r"^\s*(?:(오전|오후)\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?|(\d{1,2}):(\d{2}))")


def extract_deadline(title: str, posted_on: date) -> datetime | None:
    hits: list[datetime] = []
    previous: date | None = None
    for found in DATE_RE.finditer(title):
        before = title[max(0, found.start() - 15) : found.start()]
        after = title[found.end() : found.end() + 20]
        marked = bool(BEFORE_RE.search(before) or AFTER_RE.match(after))
        try:
            year = int(found["year"] or posted_on.year)
            current = date(year, int(found["month"]), int(found["day"]))
            if not found["year"]:
                floor = (
                    previous
                    if previous is not None and before.rstrip().endswith(("~", "∼", "～"))
                    else posted_on - timedelta(days=60)
                )
                if current < floor:
                    current = date(year + 1, current.month, current.day)
        except ValueError:
            continue
        if marked:
            clock = TIME_RE.match(after)
            if clock and clock[2]:
                hour = int(clock[2]) % 12 + (12 if clock[1] == "오후" else 0)
                minute = int(clock[3] or 0)
            elif clock:
                hour, minute = int(clock[4]), int(clock[5])
            else:
                hour, minute = 23, 59
            if hour < 24 and minute < 60:
                hits.append(datetime.combine(current, time(hour, minute), KST))
        previous = current
    return max(hits) if hits else None
