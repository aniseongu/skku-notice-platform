"""Collect shared school notices into Supabase, independently of users."""

import os
import re
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import yaml

from skku_notice.deadline import KST, extract_deadline
from skku_notice.fetch import FetchError, fetch_detail, fetch_list
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


def run_collection(settings: dict, store: NoticeStore, now: datetime) -> tuple[int, int]:
    sources = [s for s in settings["sources"] if s.get("kind") == "skku-cms" and not s.get("external")]
    if not sources or len({s["id"] for s in sources}) != len(sources):
        raise ValueError("invalid school sources")
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
                deadline = extract_deadline(notice.title, notice.posted_on)
                metadata = {
                    "id": notice_id,
                    "source_id": source["id"],
                    "article_no": notice.article_no,
                    "title": notice.title,
                    "category": notice.category,
                    "url": notice.url,
                    "posted_on": notice.posted_on.isoformat(),
                    "pinned": notice.pinned,
                    "deadline": deadline.isoformat() if deadline else None,
                }
                changed = not old or any(
                    old.get(key) != value for key, value in metadata.items() if key != "deadline"
                )
                needs_detail = not old.get("fetched_at") or (old and old.get("title") != notice.title)
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
                }
                if needs_detail:
                    try:
                        pace()
                        detail = parse_detail(fetch_detail(notice.url, agent, timeout), notice.url)
                        row.update(
                            {
                                "body": detail.body_text,
                                "body_html": detail.body_html,
                                "attachments": [
                                    {"name": n, "url": u, "type": t, "size": s}
                                    for n, u, t, s in detail.attachments
                                ],
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


def main() -> int:
    url, key = os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_SECRET_KEY", "")
    try:
        settings = yaml.safe_load(Path("config/sources.yaml").read_text(encoding="utf-8"))
        store = NoticeStore(url, key)
        try:
            count, failed = run_collection(settings, store, datetime.now(KST))
        finally:
            store.close()
    except (OSError, ValueError, yaml.YAMLError, StoreError) as exc:
        print(f"수집 설정 오류: {type(exc).__name__}", flush=True)
        return 1
    print(f"완료: {count}건 확인, 실패 게시판 {failed}개", flush=True)
    return int(failed > 0)


if __name__ == "__main__":
    raise SystemExit(main())
