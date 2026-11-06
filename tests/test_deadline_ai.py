import json
from datetime import datetime
from types import SimpleNamespace

from skku_notice import deadline_ai, gcal
from skku_notice.archive import Archive, update_ai_deadlines
from skku_notice.deadline import KST
from skku_notice.export import _public_notice


def fake(reply):
    calls = []

    def generate_content(**kwargs):
        calls.append(kwargs)
        if isinstance(reply, Exception):
            raise reply
        return SimpleNamespace(text=json.dumps(reply, ensure_ascii=False))

    return SimpleNamespace(models=SimpleNamespace(generate_content=generate_content)), calls


ITEMS = [
    {"id": "a/1", "title": "논술 시험 교통 통제 단기근로 모집", "posted_on": "2026-11-03",
     "body": "지원 마감 11. 9.(일) 18시"},
    {"id": "a/2", "title": "콜로키움", "posted_on": "2026-11-03", "body": "11월 18일 10:30 400212호"},
    {"id": "a/3", "title": "안내", "posted_on": "2026-11-03", "body": "날짜 없음"},
]


def test_batch_reads_deadline_and_event_in_one_call():
    client, calls = fake({"items": [
        {"id": "a/1", "kind": "마감", "at": "2026-11-09T18:00:00+09:00"},
        {"id": "a/2", "kind": "일정", "at": "2026-11-18T10:30:00"},
        {"id": "a/3", "kind": "없음", "at": ""},
        {"id": "other", "kind": "마감", "at": "2026-11-09T18:00:00+09:00"},
    ]})
    result = deadline_ai.read_deadlines(ITEMS, "m", "k", client)
    assert len(calls) == 1
    assert result == {"a/1": ("마감", "2026-11-09T18:00:00+09:00"),
                      "a/2": ("일정", "2026-11-18T10:30:00+09:00"),
                      "a/3": None}


def test_implausible_dates_and_failures_are_dropped():
    client, _ = fake({"items": [{"id": "a/1", "kind": "마감", "at": "2019-01-01T00:00:00+09:00"},
                                {"id": "a/2", "kind": "일정", "at": "not a date"}]})
    assert deadline_ai.read_deadlines(ITEMS[:2], "m", "k", client) == {"a/1": None, "a/2": None}
    broken, _ = fake(RuntimeError("quota"))
    assert deadline_ai.read_deadlines(ITEMS, "m", "k", broken) is None


def test_body_date_fills_public_notice_and_calendar():
    notice = {"id": "a/1", "source_id": "a", "article_no": "1", "title": "모집", "category": None,
              "url": "https://www.skku.edu/1", "posted_on": "2026-11-03", "pinned": False,
              "deadline": None, "first_seen": None}
    found = {"a/1": ("일정", "2026-11-18T10:30:00+09:00")}
    archive = update_ai_deadlines(Archive({"a/1": {"notice": notice}}), found, "m")
    item = archive.items["a/1"]
    assert item["ai_deadline"]["checked"]
    public = _public_notice(item)
    assert public["deadline"] == "2026-11-18T10:30:00+09:00" and public["deadline_kind"] == "일정"
    now = datetime(2026, 11, 3, tzinfo=KST)
    events = gcal.desired_events([public], [public | {"saved_at": "x"}], now)
    event = next(iter(events.values()))
    assert event["summary"] == "모집"
    assert event["start"]["dateTime"].startswith("2026-11-18T10:30")
    assert event["end"]["dateTime"].startswith("2026-11-18T11:30")
