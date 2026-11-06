"""Collect a public, non-personal school notice snapshot for the preview.

This is a manual snapshot, not the scheduled multi-user worker. It never reads
profiles, credentials, match results or external internship sources.
"""

import argparse
import json
import os
import re
import tempfile
import time
from datetime import datetime
from pathlib import Path

import yaml

from skku_notice.deadline import KST, extract_deadline
from skku_notice.fetch import FetchError, fetch_detail, fetch_list
from skku_notice.parse import ParseError, parse_detail, parse_list


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as tmp:
        try:
            json.dump(data, tmp, ensure_ascii=False, indent=2)
            tmp.write("\n")
            tmp_path = Path(tmp.name)
        except BaseException:
            Path(tmp.name).unlink(missing_ok=True)
            raise
    try:
        os.replace(tmp_path, path)
    finally:
        tmp_path.unlink(missing_ok=True)


def collect_snapshot(settings: dict, destination: Path, now: datetime) -> tuple[int, int]:
    """Fetch trusted school sources; publish the list only after every list succeeds."""
    sources = [s for s in settings["sources"] if s.get("kind") == "skku-cms" and not s.get("external")]
    if not sources or len({s["id"] for s in sources}) != len(sources):
        raise ValueError("invalid school source configuration")
    if any(not re.fullmatch(r"[\w-]+", s["id"]) for s in sources):
        raise ValueError("invalid source id")
    stamp = now.astimezone(KST).isoformat()
    gap = max(1.5, float(settings.get("request_gap_seconds", 1.5)))
    agent, timeout = settings["user_agent"], float(settings["timeout_seconds"])
    last_request = None

    def pace():
        nonlocal last_request
        if last_request is not None:
            time.sleep(max(0, gap - (time.monotonic() - last_request)))
        last_request = time.monotonic()

    notices = []
    for source in sources:
        pace()
        page = fetch_list(source["url"], agent, timeout)
        notices.extend(parse_list(page, source["id"], source["url"]))

    public = []
    details = 0
    for notice in notices:
        deadline = extract_deadline(notice.title, notice.posted_on)
        public.append(
            {
                "id": f"{notice.source_id}/{notice.article_no}",
                "source_id": notice.source_id,
                "article_no": notice.article_no,
                "title": notice.title,
                "category": notice.category,
                "url": notice.url,
                "posted_on": notice.posted_on.isoformat(),
                "pinned": notice.pinned,
                "deadline": deadline.isoformat() if deadline else None,
                "first_seen": stamp,
            }
        )
        try:
            pace()
            detail = parse_detail(fetch_detail(notice.url, agent, timeout), notice.url)
        except (FetchError, ParseError, ValueError) as exc:
            print(
                f"{notice.source_id}/{notice.article_no}: 상세 조회 실패 ({type(exc).__name__})", flush=True
            )
            continue
        _write_json(
            destination / "notices" / notice.source_id / f"{notice.article_no}.json",
            {
                "version": 1,
                "id": f"{notice.source_id}/{notice.article_no}",
                "summary": None,
                "body": detail.body_text,
                "body_html": detail.body_html,
                "body_status": "ready",
                "summary_status": "pending",
                "attachments": [
                    {"name": n, "url": u, "type": t, "size": s} for n, u, t, s in detail.attachments
                ],
                "images": list(detail.images),
                "body_from_image": False,
                "fetched_at": stamp,
            },
        )
        details += 1
    public.sort(key=lambda n: (n["posted_on"], n["id"]), reverse=True)
    _write_json(
        destination / "notices.json",
        {
            "version": 1,
            "generated_at": stamp,
            "sources": [{"id": s["id"], "name": s["name"], "url": s["url"]} for s in sources],
            "notices": public,
        },
    )
    return len(public), details


def main() -> int:
    parser = argparse.ArgumentParser(description="학교 공지 공개 미리보기 수집")
    parser.add_argument("--output", type=Path, default=Path("web/public/api/v1"))
    args = parser.parse_args()
    settings = yaml.safe_load(Path("config/sources.yaml").read_text(encoding="utf-8"))
    count, details = collect_snapshot(settings, args.output, datetime.now(KST))
    print(f"학교 공지 {count}건, 본문 {details}건을 수집했어요.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
