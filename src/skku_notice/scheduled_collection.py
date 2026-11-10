"""Collect shared school notices into Supabase, independently of users."""

import os
import re
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import yaml

from skku_notice.deadline import KST, extract_deadline
from skku_notice.fetch import FetchError, fetch_detail, fetch_json_post, fetch_list
from skku_notice.jobs import (
    COLLECTORS,
    LK_API,
    LK_DETAIL,
    LK_HEADERS,
    parse_job_detail,
    parse_linkareer_detail,
    skku_career_list,
)
from skku_notice.parse import ParseError, parse_detail, parse_list


class StoreError(RuntimeError):
    """A public notice store operation failed without exposing credentials."""


class NoticeStore:
    def __init__(self, url: str, key: str):
        parsed = urlsplit(url)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or not parsed.hostname.endswith(".supabase.co")
            or parsed.username
            or parsed.password
            or parsed.port
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
            or not key.startswith("sb_secret_")
        ):
            raise ValueError("invalid Supabase worker configuration")
        self.client = httpx.Client(
            base_url=f"https://{parsed.hostname}/rest/v1/",
            timeout=30,
            headers={"apikey": key},
        )

    def _request(self, method: str, path: str, **kwargs):
        try:
            result = self.client.request(method, path, **kwargs)
            result.raise_for_status()
            return result
        except httpx.HTTPError as exc:
            raise StoreError(f"notice store request failed: {type(exc).__name__}") from exc

    def source(self, source_id: str) -> dict | None:
        rows = self._request(
            "GET", "platform_sources", params={"id": f"eq.{source_id}", "select": "*"}
        ).json()
        return rows[0] if rows else None

    def notices(self, source_id: str, article_numbers: list[str]) -> dict[str, dict]:
        if not article_numbers:
            return {}
        # Limit the response to the current board page, even when the archive grows.
        if not re.fullmatch(r"[a-z0-9-]+", source_id) or any(
            not n.isascii() or not n.isdecimal() for n in article_numbers
        ):
            raise ValueError("invalid notice id")
        ids = ",".join(f'"{source_id}/{n}"' for n in article_numbers)
        rows = self._request("GET", "platform_notices", params={"id": f"in.({ids})", "select": "*"}).json()
        return {row["id"]: row for row in rows}

    def subscribed_source_ids(self) -> set[str]:
        """Boards that at least one user follows. Only these on-demand boards are collected."""
        rows = self._request(
            "GET", "user_source_subscriptions", params={"select": "source_id", "limit": "20000"}
        ).json()
        return {row["source_id"] for row in rows}

    def register_sources(self, rows: list[dict]) -> None:
        """Make catalog boards subscribable without touching boards that already have a collection history."""
        if rows:
            self._request(
                "POST",
                "platform_sources",
                params={"on_conflict": "id"},
                json=rows,
                headers={"Prefer": "resolution=ignore-duplicates,return=minimal"},
            )

    def upsert(self, table: str, rows: list[dict]) -> None:
        if rows:
            self._request(
                "POST",
                table,
                params={"on_conflict": "id"},
                json=rows,
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            )

    def close(self):
        self.client.close()


# 처음 구독이 몰려도 서버가 오래 묶이지 않게, 한 번의 실행에서 받는 본문 수를 제한한다.
# 못 받은 글은 다음 실행에 이어서 받는다.
DETAIL_BUDGET = 60


def school_sources(settings: dict) -> list[dict]:
    sources = [s for s in settings["sources"] if s.get("kind") == "skku-cms" and not s.get("external")]
    if not sources or len({s["id"] for s in sources}) != len(sources):
        raise ValueError("invalid school sources")
    return sources


def collection_targets(settings: dict, subscribed: set[str]) -> list[dict]:
    """Default boards always; catalog (on_demand) boards only when someone follows them."""
    return [s for s in school_sources(settings) if not s.get("on_demand") or s["id"] in subscribed]


def register_catalog(settings: dict, store: NoticeStore) -> None:
    catalog = [s for s in school_sources(settings) if s.get("on_demand")]
    store.register_sources([{"id": s["id"], "name": s["name"], "url": s["url"]} for s in catalog])


def run_collection(
    settings: dict, store: NoticeStore, now: datetime, subscribed: set[str] | None = None
) -> tuple[int, int]:
    sources = collection_targets(settings, subscribed or set())
    if not sources:
        return 0, 0
    details_left = DETAIL_BUDGET
    stamp = now.astimezone(KST).isoformat()
    gap = max(1.5, float(settings.get("request_gap_seconds", 1.5)))
    agent, timeout = settings["user_agent"], float(settings["timeout_seconds"])
    last_request = None
    total, failed = 0, 0

    def pace():
        nonlocal last_request
        if last_request is not None:
            time.sleep(max(0, gap - (time.monotonic() - last_request)))
        last_request = time.monotonic()

    for source in sources:
        try:
            pace()
            notices = parse_list(fetch_list(source["url"], agent, timeout), source["id"], source["url"])
            # A pinned notice can also appear in the regular list. Keep it only once.
            notices = list({n.article_no: n for n in reversed(notices)}.values())
            previous = store.notices(source["id"], [n.article_no for n in notices])
            previous_source = store.source(source["id"]) or {}
            source_row = {
                "id": source["id"],
                "name": source["name"],
                "url": source["url"],
                "last_success_at": previous_source.get("last_success_at"),
            }
            store.upsert("platform_sources", [source_row])
            updates = []
            # Recheck at most one old body per board per run, including edits with unchanged titles.
            # 새 글은 작성자가 곧바로 고치고 포스터를 바꾸므로 먼저, 더 자주 다시 읽는다.
            due = []
            for notice in notices:
                old = previous.get(f"{source['id']}/{notice.article_no}", {})
                try:
                    checked = datetime.fromisoformat(old.get("fetched_at") or "")
                    if not checked.tzinfo:
                        continue
                    age = now - checked
                    recent = False
                    if old.get("first_seen"):
                        seen = datetime.fromisoformat(old["first_seen"])
                        recent = bool(seen.tzinfo) and now - seen < RECHECK_RECENT_WINDOW
                    if age >= RECHECK_INTERVAL or (recent and age >= RECHECK_RECENT_INTERVAL):
                        due.append((not recent, checked, notice.article_no))
                except (TypeError, ValueError):
                    pass
            recheck_number = min(due)[2] if due else None
            for notice in notices:
                notice_id = f"{source['id']}/{notice.article_no}"
                old = previous.get(notice_id, {})
                # 학교 목록은 고친 글의 날짜를 오늘로 바꿔 보여 준다. 원본(alert)처럼 처음 본 게시일을 지켜
                # 고친 글이 새 글처럼 "오늘"에 올라오지 않게 한다. 수정은 changed_at과 "수정됨"으로 알린다.
                posted_on = _first_posted_on(old, notice.posted_on)
                deadline = extract_deadline(notice.title, posted_on)
                metadata = {
                    "id": notice_id,
                    "source_id": source["id"],
                    "article_no": notice.article_no,
                    "title": notice.title,
                    "category": notice.category,
                    "url": notice.url,
                    "posted_on": posted_on.isoformat(),
                    "pinned": notice.pinned,
                    "deadline": deadline.isoformat() if deadline else None,
                }
                changed = not old or any(
                    old.get(key) != value for key, value in metadata.items() if key != "deadline"
                )
                title_changed = bool(old) and old.get("title") != notice.title
                needs_detail = (
                    not old.get("fetched_at") or title_changed or notice.article_no == recheck_number
                )
                if not changed and not needs_detail:
                    continue
                row = {
                    **metadata,
                    "first_seen": old.get("first_seen", stamp),
                    "fetched_at": old.get("fetched_at"),
                    "body": old.get("body"),
                    "body_html": old.get("body_html"),
                    "attachments": old.get("attachments", []),
                    "images": old.get("images", []),
                    "changed_at": stamp if title_changed else old.get("changed_at"),
                    "change_kind": "제목" if title_changed else old.get("change_kind"),
                    "previous_title": old.get("title") if title_changed else old.get("previous_title"),
                }
                if needs_detail and details_left <= 0:
                    # 이번 실행의 본문 한도를 넘었다. 본문 없이 저장하고 다음 실행에서 이어 받는다.
                    if title_changed:
                        row["fetched_at"] = None
                    needs_detail = False
                if needs_detail:
                    details_left -= 1
                    try:
                        pace()
                        detail = parse_detail(fetch_detail(notice.url, agent, timeout), notice.url)
                        new_attachments = [
                            {"name": n, "url": u, "type": t, "size": s} for n, u, t, s in detail.attachments
                        ]
                        if (
                            old.get("fetched_at")
                            and not title_changed
                            and (
                                old.get("body") != detail.body_text
                                or old.get("body_html") != detail.body_html
                                or old.get("attachments", []) != new_attachments
                                or old.get("images", []) != list(detail.images)
                            )
                        ):
                            row.update({"changed_at": stamp, "change_kind": "본문", "previous_title": None})
                        row.update(
                            {
                                "body": detail.body_text,
                                "body_html": detail.body_html,
                                "attachments": new_attachments,
                                "images": list(detail.images),
                                "fetched_at": stamp,
                            }
                        )
                    except (FetchError, ParseError, ValueError) as exc:
                        # Retry a changed notice on the next run without discarding its old body.
                        row["fetched_at"] = None
                        print(f"{notice_id}: 본문 실패 ({type(exc).__name__})", flush=True)
                updates.append(row)
            store.upsert("platform_notices", updates)
            store.upsert("platform_sources", [{**source_row, "last_success_at": stamp}])
            total += len(notices)
            print(f"{source['id']}: 목록 {len(notices)}건, 변경 {len(updates)}건", flush=True)
        except (FetchError, ParseError, StoreError, KeyError, TypeError, ValueError) as exc:
            failed += 1
            print(f"{source['id']}: 수집 실패 ({type(exc).__name__})", flush=True)
    return total, failed


# 오래된 글은 하루에 한 번, 새 글은 3시간마다 본문을 다시 읽는다(포스터 교체 대응, 보드당 1건은 그대로).
RECHECK_INTERVAL = timedelta(hours=24)
RECHECK_RECENT_INTERVAL = timedelta(hours=3)
RECHECK_RECENT_WINDOW = timedelta(hours=48)
EXTERNAL_INTERVAL = timedelta(minutes=55)
EXTERNAL_DETAILS_PER_RUN = 5
EXTERNAL_DETAIL_WINDOW = timedelta(days=45)


def run_external_collection(settings: dict, store: NoticeStore, now: datetime, post=None) -> tuple[int, int]:
    """Collect approved external internship boards like the original service.

    One list request per site per run (at most once an hour), then up to five missing bodies per board.
    The school career center (skku-career-intern) is read like the original service: a plain public list page,
    no login and no bypass of access limits. Its robots.txt disallows crawling, so it is collected
    only because
    the project owner explicitly instructed it (2026-11-08), with the same hourly limit as the others.
    """
    sources = [
        s for s in settings["sources"]
        if s.get("external") and (s.get("kind") in COLLECTORS or s.get("kind") == "skku-career-intern")
    ]
    stamp = now.astimezone(KST).isoformat()
    gap = max(1.5, float(settings.get("request_gap_seconds", 1.5)))
    agent, timeout = settings["user_agent"], float(settings["timeout_seconds"])
    post = post or (lambda url, body, headers: fetch_json_post(url, body, agent, timeout, headers))
    last_request = None
    total, failed = 0, 0

    def pace():
        nonlocal last_request
        if last_request is not None:
            time.sleep(max(0, gap - (time.monotonic() - last_request)))
        last_request = time.monotonic()

    for source in sources:
        source_id = source["id"]
        try:
            previous_source = store.source(source_id) or {}
            try:
                age = now - datetime.fromisoformat(previous_source.get("last_success_at") or "")
                if age.total_seconds() >= 0 and age < EXTERNAL_INTERVAL:
                    continue
            except (TypeError, ValueError):
                pass
            pace()
            if source["kind"] == "skku-career-intern":
                postings = skku_career_list(fetch_list(source["url"], agent, timeout), now, source_id)
            else:
                postings = COLLECTORS[source["kind"]](post, now, source_id)
            numbers = [notice.article_no for notice, _ in postings]
            previous = store.notices(source_id, numbers)
            source_row = {
                "id": source_id,
                "name": source["name"],
                "url": source["url"],
                "external": True,
                "last_success_at": previous_source.get("last_success_at"),
            }
            store.upsert("platform_sources", [source_row])
            rows = []
            for notice, deadline in postings:
                notice_id = f"{source_id}/{notice.article_no}"
                old = previous.get(notice_id, {})
                title_changed = bool(old) and old.get("title") != notice.title
                rows.append(
                    {
                        "id": notice_id,
                        "source_id": source_id,
                        "article_no": notice.article_no,
                        "title": notice.title,
                        "category": notice.category,
                        "url": notice.url,
                        "posted_on": notice.posted_on.isoformat(),
                        "pinned": False,
                        "deadline": deadline,
                        "first_seen": old.get("first_seen", stamp),
                        "fetched_at": old.get("fetched_at"),
                        "body": old.get("body"),
                        "body_html": old.get("body_html"),
                        "attachments": old.get("attachments", []),
                        "images": old.get("images", []),
                        "changed_at": stamp if title_changed else old.get("changed_at"),
                        "change_kind": "제목" if title_changed else old.get("change_kind"),
                        "previous_title": (
                            old.get("title") if title_changed else old.get("previous_title")
                        ),
                    }
                )
            # Newest postings without a body first; a failed body stays empty and is retried next run.
            waiting = sorted(
                (r for r in rows if not r["fetched_at"] and _recent(r["posted_on"], now)),
                key=lambda r: (r["posted_on"], r["first_seen"]),
                reverse=True,
            )[:EXTERNAL_DETAILS_PER_RUN]
            for row in waiting:
                try:
                    pace()
                    if source["kind"] == "linkareer":
                        query = {"query": LK_DETAIL, "variables": {"id": row["article_no"]}}
                        data = post(LK_API, query, LK_HEADERS)
                        detail = parse_linkareer_detail(data, row["article_no"], row["url"])
                    else:
                        html = fetch_detail(row["url"], agent, timeout)
                        detail = parse_job_detail(html, source["kind"], row["article_no"], row["url"])
                    row.update(
                        {
                            "body": detail.body_text,
                            "body_html": detail.body_html,
                            "attachments": [
                                {"name": n, "url": u, "type": t, "size": z}
                                for n, u, t, z in detail.attachments
                            ],
                            "images": list(detail.images),
                            "fetched_at": stamp,
                        }
                    )
                except (FetchError, ParseError, ValueError) as exc:
                    print(f"{row['id']}: 본문 실패 ({type(exc).__name__})", flush=True)
            store.upsert("platform_notices", rows)
            store.upsert("platform_sources", [{**source_row, "last_success_at": stamp}])
            total += len(rows)
            print(f"{source_id}: 외부 목록 {len(rows)}건, 본문 {len(waiting)}건 시도", flush=True)
        except (FetchError, ParseError, StoreError, KeyError, TypeError, ValueError) as exc:
            failed += 1
            print(f"{source_id}: 외부 수집 실패 ({type(exc).__name__})", flush=True)
    return total, failed


def _first_posted_on(old: dict, listed: date) -> date:
    """이미 저장한 글이면 저장된 게시일, 처음 보는 글이면 목록의 날짜."""
    try:
        return date.fromisoformat(str(old["posted_on"])[:10])
    except (KeyError, TypeError, ValueError):
        return listed


def _recent(posted_on: str, now: datetime) -> bool:
    try:
        return now.date() - datetime.fromisoformat(posted_on).date() <= EXTERNAL_DETAIL_WINDOW
    except ValueError:
        return False


def recently_collected(
    settings: dict,
    store: NoticeStore,
    now: datetime,
    minimum_minutes: int = 25,
    subscribed: set[str] | None = None,
) -> bool:
    """Skip duplicate runs while allowing the 30-minute timer to collect normally."""
    sources = collection_targets(settings, subscribed or set())
    if not sources:
        return False
    for source in sources:
        row = store.source(source["id"]) or {}
        try:
            last = datetime.fromisoformat(row.get("last_success_at") or "")
            age = now - last
            if not last.tzinfo or age < timedelta(0) or age >= timedelta(minutes=minimum_minutes):
                return False
        except (TypeError, ValueError):
            return False
    return True


def main() -> int:
    url, key = os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_SECRET_KEY", "")
    try:
        settings = yaml.safe_load(Path("config/sources.yaml").read_text(encoding="utf-8"))
        store = NoticeStore(url, key)
        try:
            now = datetime.now(KST)
            register_catalog(settings, store)
            subscribed = store.subscribed_source_ids()
            if recently_collected(settings, store, now, subscribed=subscribed):
                print("최근에 모든 게시판을 확인해 이번 중복 요청을 건너뛰어요.", flush=True)
                count, failed = 0, 0
            else:
                count, failed = run_collection(settings, store, now, subscribed)
            # 외부 인턴 공고는 원본처럼 학교 게시판과 독립적으로 시간당 한 번 확인한다.
            # 실패해도 학교 수집 결과와 종료 코드에는 영향을 주지 않는다.
            external_count, _external_failed = run_external_collection(settings, store, now)
            count += external_count
        finally:
            store.close()
    except (OSError, ValueError, yaml.YAMLError, StoreError) as exc:
        print(f"수집 설정 오류: {type(exc).__name__}", flush=True)
        return 1
    print(f"완료: {count}건 확인, 실패 게시판 {failed}개", flush=True)
    return int(failed > 0)


if __name__ == "__main__":
    raise SystemExit(main())
