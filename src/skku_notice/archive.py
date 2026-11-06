"""Recent notice snapshots and decisions for static exports."""

import json
from dataclasses import dataclass, field
from pathlib import Path

from skku_notice.deadline import extract_deadline
from skku_notice.judge import Judgment
from skku_notice.model import Match, Notice

# 외부 인턴 공고(D-026)까지 담아 학교 공지가 밀려나지 않게 늘렸다.
MAX_ARCHIVE = 500


@dataclass(frozen=True)
class Archive:
    items: dict[str, dict] = field(default_factory=dict)
    version: int = 1


def load_archive(path: Path) -> Archive:
    if not path.exists():
        return Archive()
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("version") != 1 or not isinstance(raw.get("items"), dict):
        raise ValueError("unsupported archive format")
    for item in raw["items"].values():
        item["attachments"] = [
            {field: attachment.get(field) for field in ("name", "url", "type", "size")}
            for attachment in item.get("attachments", [])
        ]
        if item.get("ocr_engine") and item.get("body_from_image") and "ocr_text" not in item:
            item["ocr_text"] = item.get("body_text") or ""
            item["body_text"] = ""
            item["body_from_image"] = False
    return Archive(raw["items"])


def add_notice(
    archive: Archive,
    notice: Notice,
    first_seen: str,
    match: Match | None = None,
    judgment: Judgment | None = None,
    priority: str | None = None,
    notified: bool = False,
    interests: tuple[str, ...] = (),
) -> Archive:
    key = f"{notice.source_id}/{notice.article_no}"
    deadline = extract_deadline(notice.title, notice.posted_on)
    public = {
        "id": key,
        "source_id": notice.source_id,
        "article_no": notice.article_no,
        "title": notice.title,
        "category": notice.category,
        "url": notice.url,
        "posted_on": notice.posted_on.isoformat(),
        "pinned": notice.pinned,
        "deadline": deadline.isoformat() if deadline else None,
        "first_seen": first_seen,
    }
    personal = {
        "rule_name": match.rule_name if match else None,
        "priority": priority,
        "interests": list(interests),
        "reasons": list(match.reasons) if match else [],
        "ai": {
            "verdict": judgment.verdict,
            "reason": judgment.reason,
            "model": judgment.model,
            "interests": list(judgment.interests),
        }
        if judgment
        else None,
        "notified": notified,
    }
    old = archive.items.get(key, {})
    image_text = judgment.image_text if judgment and judgment.image_text and old.get("images") else ""
    # 번역, 본문 마감, 수정 기록처럼 다른 단계가 붙인 칸은 그대로 둔다(예전에는 여기서 지워져 다시 만들었다).
    items = {**archive.items, key: {
        **old,
        "notice": public, "match": personal,
        "body_text": image_text or old.get("body_text"),
        "body_from_image": bool(image_text) or old.get("body_from_image", False),
        "ocr_text": old.get("ocr_text", ""),
        "ocr_engine": old.get("ocr_engine"),
        "image_attempted": old.get("image_attempted", False),
        "attachments": [
            {field: attachment.get(field) for field in ("name", "url", "type", "size")}
            for attachment in old.get("attachments", [])
        ],
        "body_html": old.get("body_html"),
        "images": old.get("images", []),
        "summary": judgment.summary if judgment and judgment.summary else old.get("summary"),
        "body_attempts": old.get("body_attempts", 0),
        "fetched_at": old.get("fetched_at"),
    }}
    ordered = sorted(
        items.items(),
        key=lambda pair: (pair[1]["notice"]["posted_on"], pair[1]["notice"]["first_seen"], pair[0]),
        reverse=True,
    )
    return Archive(dict(ordered[:MAX_ARCHIVE]))


def update_detail(
    archive: Archive, key: str, body: str | None, attachments: tuple[tuple[str, str, str, str | None], ...],
    fetched_at: str | None, images: tuple[str, ...] = (), body_html: str | None = None,
    attempted_at: str | None = None,
) -> Archive:
    item = archive.items[key]
    updated = {**item, "body_text": body, "body_html": body_html,
               "attachments": [
        {"name": name, "url": url, "type": kind, "size": size}
        for name, url, kind, size in attachments
    ], "images": list(images), "fetched_at": fetched_at, "body_attempted_at": attempted_at or fetched_at,
        "body_attempts": item.get("body_attempts", 0) + 1}
    return Archive({**archive.items, key: updated})


def mark_image_attempted(archive: Archive, key: str) -> Archive:
    return Archive({**archive.items, key: {**archive.items[key], "image_attempted": True}})


def update_ai_deadlines(archive: Archive, results: dict, model: str) -> Archive:
    """Body-read dates for notices whose title has none. Checked notices are not asked again."""
    items = dict(archive.items)
    for key, found in results.items():
        if key not in items:
            continue
        entry = {"checked": True, "model": model}
        if found:
            entry.update(kind=found[0], at=found[1])
        items[key] = {**items[key], "ai_deadline": entry}
    return Archive(items)


def update_translation(archive: Archive, key: str, result: tuple[str, str] | None, model: str) -> Archive:
    """Korean translation of an English notice. Failures count attempts so a broken notice stops retrying."""
    item = archive.items[key]
    if result is None:
        attempts = item.get("translation_attempts", 0) + 1
        return Archive({**archive.items, key: {**item, "translation_attempts": attempts}})
    title, body = result
    translation = {"title": title, "body": body, "model": model}
    return Archive({**archive.items, key: {**item, "translation": translation}})


def update_image_text(archive: Archive, key: str, text: str, engine: str = "rapidocr") -> Archive:
    return Archive({**archive.items, key: {
        **archive.items[key], "ocr_text": text, "ocr_engine": engine,
    }})


def save_archive(path: Path, archive: Archive) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"version": archive.version, "items": archive.items}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


# 글이 바뀌면 옮긴 글과 본문 마감은 다시 만든다.
REDO_ON_CHANGE = ("translation", "translation_attempts", "ai_deadline", "summary", "summary_attempts",
                  "summary_attempted_at", "summary_last_failed_at")


def note_list_changes(archive: Archive, notices: list, now: str) -> tuple[Archive, list[str]]:
    """Seen notices whose list title changed (for example a deadline extension in the title)."""
    items = dict(archive.items)
    changed = []
    for notice in notices:
        key = f"{notice.source_id}/{notice.article_no}"
        item = items.get(key)
        if not item or item["notice"]["title"] == notice.title:
            continue
        deadline = extract_deadline(notice.title, notice.posted_on)
        public = {**item["notice"], "title": notice.title,
                  "deadline": deadline.isoformat() if deadline else None}
        # 제목이 바뀌면 옮긴 글과 본문 마감도 다시 만든다.
        rest = {k: v for k, v in item.items() if k not in REDO_ON_CHANGE}
        items[key] = {**rest, "notice": public, "previous_title": item["notice"]["title"],
                      "changed_at": now, "change_kind": "제목"}
        changed.append(key)
    return Archive(items), changed


def note_body_change(archive: Archive, key: str, body: str | None, now: str) -> tuple[Archive, bool]:
    """Re-read body of an important notice. Marks a change only when the text really differs."""
    item = archive.items[key]
    if body is None or (body or "").strip() == (item.get("body_text") or "").strip():
        return Archive({**archive.items, key: {**item, "rechecked_at": now}}), False
    rest = {k: v for k, v in item.items() if k not in REDO_ON_CHANGE}
    return Archive({**archive.items, key: {**rest, "body_text": body, "rechecked_at": now,
                                           "changed_at": now, "change_kind": "본문"}}), True


def set_source_deadlines(archive: Archive, deadlines: dict[str, str]) -> Archive:
    """External postings carry their own deadline, stored like a body-read one for export and calendars."""
    items = dict(archive.items)
    for key, at in deadlines.items():
        if key in items:
            found = {"checked": True, "kind": "마감", "at": at, "model": "source"}
            items[key] = {**items[key], "ai_deadline": found}
    return Archive(items)
