"""Collect shared school notices into Supabase, independently of users."""

import os
import re
import time
from datetime import UTC, date, datetime, timedelta
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

    def recheck_pool(self, source_ids: list[str], recent_since: str) -> tuple[list[dict], set[str]]:
        """다시 읽을 후보 글과 "중요한 글" 번호(누군가 저장했거나 AI 판정이 관련 있음·확인 필요인 글)."""
        cols = ("id,source_id,article_no,title,category,url,posted_on,pinned,deadline,first_seen,fetched_at,"
                "body,body_html,attachments,images,changed_at,change_kind,previous_title")
        important = set()
        for table, params in (
            ("user_notice_states", {"is_saved": "eq.true", "select": "notice_id", "limit": "5000"}),
            ("user_notice_judgments",
             {"verdict": "in.(relevant,maybe)", "select": "notice_id", "limit": "5000"}),
        ):
            important |= {row["notice_id"] for row in self._request("GET", table, params=params).json()}
        sources = ",".join(source_ids)
        rows = self._request("GET", "platform_notices", params={
            "source_id": f"in.({sources})", "fetched_at": "not.is.null", "first_seen": f"gte.{recent_since}",
            "select": cols, "limit": "500"}).json()
        pinned = self._request("GET", "platform_notices", params={
            "source_id": f"in.({sources})", "fetched_at": "not.is.null", "pinned": "eq.true",
            "select": cols, "limit": "200"}).json()
        have = {row["id"] for row in rows}
        rows += [row for row in pinned if row["id"] not in have]
        have = {row["id"] for row in rows}
        wanted = sorted(i for i in important if i not in have and i.split("/")[0] in source_ids)[:200]
        if wanted:
            ids = ",".join(f'"{i}"' for i in wanted)
            rows += self._request("GET", "platform_notices", params={
                "id": f"in.({ids})", "fetched_at": "not.is.null", "select": cols}).json()
        return rows, important

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

    def clear_dormant(self, source_ids: list[str]) -> None:
        """구독자가 없어 수집하지 않는 게시판의 마지막 성공 시각을 비운다.
        화면의 기준 시각은 가장 오래된 성공 시각을 따라서, 수집이 멈춘 게시판이 남아 있으면
        모든 사용자에게 "새 공지를 못 가져왔어요"가 뜬다(비운 값은 계산에서 빠진다).
        나중에 누가 구독하면 다시 수집되고 시각이 채워진다."""
        if source_ids:
            self._request(
                "PATCH", "platform_sources",
                params={"id": f"in.({','.join(source_ids)})", "last_success_at": "not.is.null"},
                json={"last_success_at": None},
                headers={"Prefer": "return=minimal"},
            )

    def purge_expired(self) -> dict:
        """보관 기간이 지난 공지와 딸린 데이터를 지운다(마감 30일 뒤, 마감 없으면 90일 뒤, 저장한 공지 제외).
        배치라 수집 때마다 불러도 가볍다. 지운 번호는 기록해, 다시 수집돼도 새 글로 들어오지 않는다."""
        data = self._request("POST", "rpc/purge_expired_data", json={}).json()
        return data if isinstance(data, dict) else {}

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
                needs_detail = not old.get("fetched_at") or title_changed
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
    try:
        rechecked = run_recheck(sources, store, settings, now)
        if rechecked:
            print(f"본문 다시 읽기 {rechecked}건", flush=True)
    except (StoreError, KeyError, TypeError, ValueError) as exc:
        print(f"본문 다시 읽기 실패 ({type(exc).__name__})", flush=True)
    return total, failed


# 원본(alert)과 같은 재확인: 실행당 최대 3건, 중요한 글(저장했거나 관련 있음·확인 필요)은 12시간마다 먼저,
# 올라온 지 48시간 안의 새 글은 3시간마다(최신 글 먼저). 마감이 지난 글은 읽지 않는다.
RECHECK_PER_RUN = 3
RECHECK_IMPORTANT_INTERVAL = timedelta(hours=12)
RECHECK_RECENT_INTERVAL = timedelta(hours=3)
RECHECK_RECENT_WINDOW = timedelta(hours=48)
RECHECK_PINNED_INTERVAL = timedelta(hours=24)   # 오래된 고정 공지도 하루에 한 번은 본문이 바뀌었는지 본다
EXTERNAL_INTERVAL = timedelta(minutes=55)
EXTERNAL_DETAILS_PER_RUN = 5
EXTERNAL_DETAIL_WINDOW = timedelta(days=45)


def _when(value: object) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else None


def recheck_candidates(rows: list[dict], important: set[str], now: datetime) -> list[dict]:
    """다시 읽을 글을 정한다(원본 _recheck_candidates와 같은 순서): 중요한 글, 그다음 갓 올라온 글(최신순)."""
    urgent: list[tuple[datetime, str, dict]] = []
    fresh: list[tuple[datetime, str, dict]] = []
    stale: list[tuple[datetime, str, dict]] = []
    for row in rows:
        fetched, seen = _when(row.get("fetched_at")), _when(row.get("first_seen"))
        deadline = _when(row.get("deadline"))
        if fetched is None or ".skku.edu/" not in str(row.get("url", "")) or (deadline and deadline < now):
            continue
        age = now - fetched
        is_recent = seen is not None and now - seen < RECHECK_RECENT_WINDOW
        if row["id"] in important and age >= RECHECK_IMPORTANT_INTERVAL:
            urgent.append((fetched, row["id"], row))
        elif is_recent and age >= RECHECK_RECENT_INTERVAL:
            fresh.append((seen, row["id"], row))
        elif row.get("pinned") and age >= RECHECK_PINNED_INTERVAL:
            stale.append((fetched, row["id"], row))
    urgent.sort(key=lambda item: (item[0], item[1]))
    fresh.sort(key=lambda item: item[1])
    fresh.sort(key=lambda item: item[0], reverse=True)
    # 고정 공지는 가장 오래 안 본 것부터, 위 두 종류가 자리를 다 쓰지 않았을 때만 본다.
    stale.sort(key=lambda item: (item[0], item[1]))
    return [row for _, _, row in (urgent + fresh + stale)][:RECHECK_PER_RUN]


def run_recheck(sources: list[dict], store: NoticeStore, settings: dict, now: datetime) -> int:
    """고쳐졌을 수 있는 글의 본문을 다시 읽고, 바뀌었으면 "수정됨"으로 기록한다."""
    school = [s["id"] for s in sources if not s.get("external")]
    if not school:
        return 0
    stamp = now.astimezone(KST).isoformat()
    rows, important = store.recheck_pool(school, (now - RECHECK_RECENT_WINDOW).astimezone(UTC).isoformat())
    agent, timeout = settings["user_agent"], float(settings["timeout_seconds"])
    gap = max(1.5, float(settings.get("request_gap_seconds", 1.5)))
    done = 0
    for row in recheck_candidates(rows, important, now):
        time.sleep(gap)
        try:
            detail = parse_detail(fetch_detail(row["url"], agent, timeout), row["url"])
        except (FetchError, ParseError, ValueError):
            continue
        attachments = [{"name": n, "url": u, "type": t, "size": s} for n, u, t, s in detail.attachments]
        changed = (
            row.get("body") != detail.body_text or row.get("body_html") != detail.body_html
            or row.get("attachments", []) != attachments or row.get("images", []) != list(detail.images)
        )
        update = {**row, "body": detail.body_text, "body_html": detail.body_html, "attachments": attachments,
                  "images": list(detail.images), "fetched_at": stamp}
        if changed:
            update.update({"changed_at": stamp, "change_kind": "본문", "previous_title": None})
        store.upsert("platform_notices", [update])
        done += 1
    return done


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
                        # 학교 글처럼 처음 본 날짜를 지킨다(원본은 목록이 바뀌어도 날짜를 다시 쓰지 않는다).
                        "posted_on": _first_posted_on(old, notice.posted_on).isoformat(),
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
            # 구독자 없는 게시판이 기준 시각을 끌어내리지 않게 한다. 실패해도 수집 결과에는 영향이 없다.
            try:
                catalog = [s["id"] for s in school_sources(settings) if s.get("on_demand")]
                store.clear_dormant([source_id for source_id in catalog if source_id not in subscribed])
            except StoreError as exc:
                print(f"휴면 게시판 정리 건너뜀 ({type(exc).__name__})", flush=True)
            # 보관 기간이 지난 데이터 정리. 실패해도 수집 결과에는 영향이 없다(함수가 아직 없으면 건너뛴다).
            try:
                purged = store.purge_expired()
                if any(purged.values()):
                    done = ", ".join(f"{name} {value}건" for name, value in purged.items() if value)
                    print(f"정리: {done}", flush=True)
            except StoreError as exc:
                print(f"정리 건너뜀 ({type(exc).__name__})", flush=True)
        finally:
            store.close()
    except (OSError, ValueError, yaml.YAMLError, StoreError) as exc:
        print(f"수집 설정 오류: {type(exc).__name__}", flush=True)
        return 1
    print(f"완료: {count}건 확인, 실패 게시판 {failed}개", flush=True)
    return int(failed > 0)


if __name__ == "__main__":
    raise SystemExit(main())
