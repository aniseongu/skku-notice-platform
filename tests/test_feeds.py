from datetime import datetime
from xml.etree import ElementTree

from skku_notice.deadline import KST
from skku_notice.feeds import deadlines_ics, rss_feed

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=KST)


def _notice(no: str, title: str, deadline: str | None, **extra) -> dict:
    return {"id": f"cse-notice:{no}", "source_id": "cse-notice", "article_no": no, "title": title,
            "category": None, "url": f"https://cse.skku.edu/{no}", "posted_on": "2026-11-01", "pinned": False,
            "deadline": deadline, "first_seen": None, **extra}


NOTICES = [
    _notice("1", "인턴 모집; 마감, 서류 & 면접", "2026-11-16T10:00:00+09:00", category="채용",
            posted_on="2026-11-02", first_seen="2026-11-02T09:00:00+09:00"),
    _notice("2", "날짜만 있는 마감" * 6, "2026-11-20T23:59:00+09:00"),
    _notice("3", "마감 없음", None),
]
BOARDS = {"cse-notice": "소프트웨어학과"}


def test_calendar_has_one_all_day_event_per_deadline_with_escaped_folded_lines():
    text = deadlines_ics(NOTICES, BOARDS, NOW)
    assert text.count("BEGIN:VEVENT") == 2
    assert "DTSTART;VALUE=DATE:20261116" in text and "DTEND;VALUE=DATE:20261117" in text
    assert "SUMMARY:인턴 모집\\; 마감\\, 서류 & 면접" in text
    assert "마감 10:00" in text
    assert "SUMMARY:날짜만" in text
    assert all(len(line.encode()) <= 75 for line in text.split("\r\n"))
    assert text.endswith("END:VCALENDAR\r\n")


def test_rss_is_valid_xml_with_board_prefix_and_links():
    root = ElementTree.fromstring(rss_feed(NOTICES, BOARDS, NOW))
    items = root.findall("channel/item")
    assert len(items) == 3
    assert items[0].findtext("title") == "[소프트웨어학과] 인턴 모집; 마감, 서류 & 면접"
    assert items[0].findtext("link") == NOTICES[0]["url"]
    assert items[1].findtext("pubDate").startswith("Sun, 01 Nov 2026")


def test_calendar_excludes_passed_deadlines():
    notices = [_notice("old", "지난 공지", "2026-11-03T11:59:00+09:00"),
               _notice("new", "남은 공지", "2026-11-03T12:01:00+09:00")]
    text = deadlines_ics(notices, BOARDS, NOW)
    assert "지난 공지" not in text
    assert "남은 공지" in text
