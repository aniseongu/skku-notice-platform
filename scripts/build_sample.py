# 개발용 예시 데이터 만들기. 상세 요청은 캐시가 없을 때만, 1.5초 간격, 30건 이하
"""Fill preview notice details from list fixtures and cached public view pages."""

import json
import time
from datetime import datetime
from pathlib import Path

import yaml

from skku_notice.deadline import KST
from skku_notice.fetch import FetchError, UnsafeURL, fetch_detail
from skku_notice.parse import ParseError, parse_detail, parse_list

SAMPLE_API = Path("web/sample/api/v1")
FIXTURES = Path("tests/fixtures")
CACHE = Path(".cache/sample-views")
MAX_REQUESTS = 30
REQUEST_GAP = 1.5


def _fixture_notices(sources: list[dict]) -> dict[str, object]:
    notices = {}
    for source in sources:
        source_id = source["id"]
        candidates = sorted(FIXTURES.glob(f"{source_id.replace('-', '_')}_list_*.html"))
        if not candidates:
            raise FileNotFoundError(f"list fixture not found: {source_id}")
        html = candidates[-1].read_text(encoding="utf-8")
        for notice in parse_list(html, source_id, source["url"]):
            notices[f"{notice.source_id}/{notice.article_no}"] = notice
    return notices


def _detail_json(notice, detail, fetched_at: str) -> dict:
    image_only = len(detail.body_text.strip()) < 50 and bool(detail.images)
    return {
        "version": 1,
        "id": f"{notice.source_id}/{notice.article_no}",
        "summary": None,
        "body": "" if image_only else detail.body_text,
        "body_html": detail.body_html,
        "attachments": [dict(zip(("name", "url", "type", "size"), attachment, strict=True))
                        for attachment in detail.attachments],
        "images": list(detail.images),
        "body_from_image": False,
        "fetched_at": fetched_at,
    }


def main() -> None:
    settings = yaml.safe_load(Path("config/sources.yaml").read_text(encoding="utf-8"))
    notices = _fixture_notices(settings["sources"])
    sample = json.loads((SAMPLE_API / "notices.json").read_text(encoding="utf-8"))
    requested = 0
    last_request = None
    failed = 0
    image_only = 0
    success = 0
    for item in sample["notices"]:
        key = item["id"]
        notice = notices.get(key)
        if notice is None or notice.source_id != item["source_id"] or notice.article_no != item["article_no"]:
            print(f"fixture에 없는 글: {key}")
            failed += 1
            continue
        target = SAMPLE_API / "notices" / notice.source_id / f"{notice.article_no}.json"
        cache = CACHE / notice.source_id / f"{notice.article_no}.html"
        existing = json.loads(target.read_text(encoding="utf-8")) if target.exists() else None
        if existing and existing.get("body_html"):
            existing["summary"] = None
            if len((existing.get("body") or "").strip()) < 50 and existing.get("images"):
                existing["body"] = ""
            existing["body_from_image"] = False
            target.write_text(json.dumps(existing, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            success += 1
            image_only += bool(existing["body"] == "" and existing.get("images"))
            continue
        try:
            if cache.exists():
                html = cache.read_text(encoding="utf-8")
            else:
                if requested >= MAX_REQUESTS:
                    failed += 1
                    continue
                if last_request is not None:
                    time.sleep(max(0, REQUEST_GAP - (time.monotonic() - last_request)))
                last_request = time.monotonic()
                requested += 1
                html = fetch_detail(notice.url, settings["user_agent"],
                                    float(settings["timeout_seconds"]))
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_text(html, encoding="utf-8")
            detail = parse_detail(html, notice.url)
        except (FetchError, UnsafeURL, ParseError, OSError) as exc:
            print(f"상세 실패: {key} ({type(exc).__name__})")
            failed += 1
            continue
        data = _detail_json(notice, detail, datetime.now(KST).isoformat())
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        success += 1
        image_only += bool(data["body"] == "" and data["images"])
    print(f"성공 {success}건, 실패 {failed}건, 그림뿐인 글 {image_only}건, 상세 요청 {requested}건")


if __name__ == "__main__":
    main()
