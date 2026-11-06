# 출처: https://github.com/aniseongu/WhaleExtentions/blob/main/extensions/icampus-check/gcal.js
"""Keep the user's "성대 공지" Google calendar in step with their notices' deadlines."""

import base64
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote

import httpx

from skku_notice.deadline import KST
from skku_notice.notification_policy import is_internship

TOKEN_URL = "https://oauth2.googleapis.com/token"
API = "https://www.googleapis.com/calendar/v3"
MARK = "skkuNotice"
# 마감 30분 전부터 마감까지. 구글 알림은 일정 시작 기준이라 마감 전에 울린다(아캠 플러스 D-026).
LEAD = timedelta(minutes=30)


class CalendarError(Exception):
    """Safe message only. Never carries tokens or response bodies."""


def _event_id(notice_id: str) -> str:
    # 구글 일정 id는 base32hex 소문자(a-v, 0-9)만 받는다. 같은 글은 늘 같은 id라 다시 넣어도 겹치지 않는다.
    digest = hashlib.sha256(notice_id.encode()).digest()[:20]
    return "skku" + base64.b32hexencode(digest).decode().lower().rstrip("=")


def desired_events(notices: list[dict], saved: list[dict], now: datetime,
                   external: frozenset[str] = frozenset(),
                   judgments: dict | None = None) -> dict[str, dict]:
    """Future saved notices, using current data when available."""
    by_id = {n["id"]: n for n in notices}
    chosen = {}
    for item in saved:
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            chosen.setdefault(item["id"], by_id.get(item["id"], item))
    events = {}
    for notice in chosen.values():
        ai = ((judgments or {}).get(notice["id"]) or {}).get("ai") or {}
        if (notice.get("source_id") in external or is_internship(notice.get("title", ""))) and (
            ai.get("verdict") == "not_relevant"
        ):
            continue
        if not notice.get("deadline") or not notice.get("url", "").startswith("https://"):
            continue
        at = datetime.fromisoformat(notice["deadline"]).astimezone(KST)
        kind = notice.get("deadline_kind") or "마감"
        # 마감은 30분 전부터 마감까지(알림이 마감 전에 울리게), 일정은 시작부터 한 시간.
        start, end = (at, at + timedelta(hours=1)) if kind == "일정" else (at - LEAD, at)
        if at <= now:
            continue
        events[_event_id(notice["id"])] = {
            "summary": (notice.get("title_ko") or notice["title"])[:250],
            "description": f"{notice['url']}\n성공이 넣은 일정이에요.",
            "start": {"dateTime": start.isoformat(), "timeZone": "Asia/Seoul"},
            "end": {"dateTime": end.isoformat(), "timeZone": "Asia/Seoul"},
            "source": {"title": "원문", "url": notice["url"]},
            "transparency": "transparent",
            "extendedProperties": {"private": {MARK: notice["id"]}},
        }
    return events


def _check(response: httpx.Response, what: str) -> httpx.Response:
    if response.status_code >= 400:
        raise CalendarError(f"{what} 실패: HTTP {response.status_code}")
    return response


def access_token(client: httpx.Client, client_id: str, secret: str, refresh: str) -> str:
    response = client.post(TOKEN_URL, data={
        "client_id": client_id, "client_secret": secret,
        "refresh_token": refresh, "grant_type": "refresh_token",
    })
    if response.status_code == 400 and "invalid_grant" in response.text:
        raise CalendarError("구글 연결이 끊겼어요. 설정에서 구글 캘린더를 다시 연결해 주세요")
    return _check(response, "구글 토큰 갱신").json()["access_token"]


def sync(client: httpx.Client, calendar_id: str, desired: dict[str, dict]) -> tuple[int, int, int]:
    """Insert, update and delete only events this app made (marked in private properties)."""
    base = f"{API}/calendars/{quote(calendar_id, safe='')}/events"
    existing: dict[str, dict] = {}
    page = None
    while True:
        # 이 앱이 만든 캘린더라 일정이 많지 않다. 표시(private 속성)가 있는 것만 우리 일정으로 본다.
        params: dict[str, str | int] = {"maxResults": 250}
        if page:
            params["pageToken"] = page
        body = _check(client.get(base, params=params), "일정 목록").json()
        for event in body.get("items", []):
            if (event.get("extendedProperties") or {}).get("private", {}).get(MARK):
                existing[event["id"]] = event
        page = body.get("nextPageToken")
        if not page:
            break
    added = changed = removed = 0
    for event_id, event in desired.items():
        old = existing.get(event_id)
        if old is None:
            response = client.post(base, json={"id": event_id, **event})
            if response.status_code == 409:  # 지운 일정의 id는 되살려 고친다.
                restored = client.put(f"{base}/{event_id}", json={**event, "status": "confirmed"})
                _check(restored, "일정 되살리기")
            else:
                _check(response, "일정 넣기")
            added += 1
        elif any(old.get(key) != event[key] for key in ("summary", "description")) or \
                old.get("end", {}).get("dateTime", "")[:16] != event["end"]["dateTime"][:16]:
            _check(client.put(f"{base}/{event_id}", json=event), "일정 고치기")
            changed += 1
    for event_id in existing.keys() - desired.keys():
        response = client.delete(f"{base}/{event_id}")
        if response.status_code not in (404, 410):
            _check(response, "일정 지우기")
        removed += 1
    return added, changed, removed


def main(api_dir: Path = Path("site/api/v1")) -> int:
    names = ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GOOGLE_CALENDAR_ID")
    values = {name: os.environ.get(name, "").strip() for name in names}
    bundle = os.environ.get("GOOGLE_CONNECTION", "").strip()
    if bundle:
        try:
            data = json.loads(bundle)
            keys = ("client_id", "client_secret", "refresh_token", "calendar_id")
            if not isinstance(data, dict) or not all(
                isinstance(data.get(key), str) and data[key].strip() for key in keys
            ):
                raise ValueError
            values = {name: data[key].strip() for name, key in zip(names, keys, strict=True)}
        except (ValueError, TypeError):
            print("구글 캘린더: 연결 정보를 다시 저장해 주세요", file=sys.stderr)
            return 1
    if not all(values.values()):
        print("구글 캘린더: 연결 전이라 건너뛰어요")
        return 0
    if not re.fullmatch(r"[\w.@-]{5,200}", values["GOOGLE_CALENDAR_ID"]):
        print("구글 캘린더: 캘린더 id가 올바르지 않아요", file=sys.stderr)
        return 1
    try:
        listing = json.loads((api_dir / "notices.json").read_text(encoding="utf-8"))
        notices = listing["notices"]
        judgments = json.loads((api_dir / "matched.json").read_text(encoding="utf-8"))["items"]
        external = frozenset(s["id"] for s in listing.get("sources", []) if s.get("external"))
        saved = json.loads(os.environ.get("SAVED_NOTICES") or "[]")
    except (OSError, ValueError, KeyError):
        print("구글 캘린더: 공지 파일을 읽지 못했어요", file=sys.stderr)
        return 1
    saved_list = saved if isinstance(saved, list) else []
    desired = desired_events(notices, saved_list, datetime.now(KST), external, judgments)
    try:
        with httpx.Client(timeout=15) as client:
            token = access_token(client, values["GOOGLE_CLIENT_ID"], values["GOOGLE_CLIENT_SECRET"],
                                 values["GOOGLE_REFRESH_TOKEN"])
            client.headers["Authorization"] = f"Bearer {token}"
            added, changed, removed = sync(client, values["GOOGLE_CALENDAR_ID"], desired)
    except CalendarError as exc:
        print(f"구글 캘린더: {exc}", file=sys.stderr)
        return 1
    except httpx.HTTPError as exc:
        print(f"구글 캘린더: 연결 오류 {type(exc).__name__}", file=sys.stderr)
        return 1
    print(f"구글 캘린더: 넣음 {added}, 고침 {changed}, 뺌 {removed}, 지금 {len(desired)}개")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
