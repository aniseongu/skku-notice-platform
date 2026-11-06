"""Write the fixed API v1 JSON format and optional static web shell."""

import json
import shutil
from datetime import datetime
from pathlib import Path

from skku_notice.archive import Archive
from skku_notice.deadline import KST
from skku_notice.feeds import deadlines_ics, rss_feed
from skku_notice.intern_ai import preference_safe_decision
from skku_notice.notification_policy import is_internship


def _public_notice(item: dict) -> dict:
    notice = dict(item["notice"])
    if item.get("translation"):
        notice["title_ko"] = item["translation"]["title"]
    # 학교가 글을 고친 때와 종류(제목, 본문). 추가 필드(D-025).
    if item.get("changed_at"):
        notice["changed_at"] = item["changed_at"]
        notice["change_kind"] = item.get("change_kind")
        if item.get("previous_title"):
            notice["previous_title"] = item["previous_title"]
    # 제목에 마감이 없으면 Gemini가 본문에서 읽은 날짜를 쓴다. deadline_kind는 "마감" 또는 "일정"(추가 필드).
    found = item.get("ai_deadline") or {}
    if not notice.get("deadline") and found.get("at"):
        notice["deadline"] = found["at"]
        notice["deadline_kind"] = found.get("kind", "마감")
    return notice


def export_site(
    destination: Path, archive: Archive, sources: list[dict], now: datetime, web_path: Path = Path("web/dist")
) -> None:
    api = destination / "api/v1"
    api.mkdir(parents=True, exist_ok=True)
    stamp = now.astimezone(KST).isoformat()
    ordered = sorted(
        archive.items.values(),
        key=lambda item: (item["notice"]["posted_on"], item["notice"]["first_seen"], item["notice"]["id"]),
        reverse=True,
    )
    notices = {
        "version": 1,
        "generated_at": stamp,
        # external: 외부 인턴 공고(D-026, 추가 필드). 화면은 성대 공지 탭에서 뺀다.
        "sources": [{"id": source["id"], "name": source["name"], "url": source["url"],
                     **({"external": True} if source.get("external") else {})} for source in sources],
        # title_ko는 영어 공지를 옮긴 제목(추가 필드, D-010 API v1 유지).
        "notices": [_public_notice(item) for item in ordered],
    }
    # D-010 API v1의 기존 이름을 유지하고 interests는 추가 필드로 넣는다.
    personal = {}
    external = {source["id"] for source in sources if source.get("external")}
    for item in ordered:
        decision = item["match"].copy()
        decision.setdefault("interests", [])
        if decision.get("ai") is not None:
            decision["ai"] = {**decision["ai"], "interests": decision["ai"].get("interests", [])}
            notice = item["notice"]
            if notice["source_id"] in external or is_internship(notice["title"]):
                verdict, reason = preference_safe_decision(
                    decision["ai"].get("verdict", ""), decision["ai"].get("reason", "")
                )
                decision["ai"].update(verdict=verdict, reason=reason)
        personal[item["notice"]["id"]] = decision
    matched = {
        "version": 1,
        "generated_at": stamp,
        "items": personal,
    }
    for name, data in (("notices.json", notices), ("matched.json", matched)):
        (api / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for item in ordered:
        notice = item["notice"]
        target = api / "notices" / notice["source_id"] / f"{notice['article_no']}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        attempts = item.get("body_attempts", 0)
        body_status = ("ready" if item.get("body_text") is not None else
                       "unavailable" if attempts >= 3 else "retrying" if attempts else "pending")
        detail = {
            "version": 1, "id": notice["id"], "summary": item.get("summary"),
            "summary_status": "ready" if item.get("summary") else
                              "failed" if item.get("summary_last_failed_at") else "pending",
            "body": item.get("body_text"), "body_html": item.get("body_html"),
            "body_status": body_status,
            "attachments": [{field: attachment.get(field) for field in ("name", "url", "type", "size")}
                            for attachment in item.get("attachments", [])],
            "images": item.get("images", []),
            "body_from_image": item.get("body_from_image", False),
            "translation": item.get("translation"),
            "ocr_engine": item.get("ocr_engine"),
            "fetched_at": item.get("fetched_at"),
        }
        target.write_text(json.dumps(detail, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # 마감 캘린더 구독과 RSS 피드(GOAL.md M3). 공개 공지 정보만 쓴다(Canvas는 넣지 않는다, D-012).
    board_names = {source["id"]: source["name"] for source in sources}
    listed = [_public_notice(item) for item in ordered]
    calendar = deadlines_ics(listed, board_names, now)
    (destination / "deadlines.ics").write_text(calendar, encoding="utf-8", newline="")
    (destination / "feed.xml").write_text(rss_feed(listed, board_names, now), encoding="utf-8")
    if web_path.is_dir():
        shutil.copytree(web_path, destination, dirs_exist_ok=True)
