"""Load and match personal interest keywords against notice text."""

import re
from pathlib import Path

import yaml

from skku_notice.model import Notice

# 관심 키워드는 그 글자가 제목, 분류, 본문, 그림 글자에 그대로 있을 때만 맞는다(D-024).


def load_interests(path: Path, environment: str = "") -> tuple[str, ...]:
    keywords = re.split(r"[,\n]", environment)
    if path.exists():
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("keywords"), list):
            raise ValueError("interests YAML must contain a keywords list")
        if not all(isinstance(item, str) for item in data["keywords"]):
            raise ValueError("interest keywords must be strings")
        keywords.extend(data["keywords"])
    return tuple(dict.fromkeys(word.strip() for word in keywords if word.strip()))


def _compact(value: str) -> str:
    return "".join(value.casefold().split())


def match_interests(notice: Notice, keywords: tuple[str, ...], ocr_text: str = "") -> tuple[str, ...]:
    haystack = _compact(f"{notice.title} {notice.category or ''} {ocr_text}")
    matched = []
    for keyword in keywords:
        words = keyword.split()
        if words and all(_compact(word) in haystack for word in words):
            matched.append(keyword)
    return tuple(matched)


def muted_from_env(value: str) -> frozenset[str]:
    """Categories the user turned off in settings (Actions variable MUTED_CATEGORIES)."""
    return frozenset(word.strip() for word in re.split(r"[,\n]", value) if word.strip())


def refresh_archive_interests(items: dict, keywords: tuple[str, ...]) -> dict:
    """Recompute every archived notice's interests with literal matching (old ones used similar words)."""
    refreshed = {}
    for key, item in items.items():
        notice = item["notice"]
        haystack = _compact(" ".join(filter(None, (
            notice.get("title"), notice.get("category"), item.get("body_text"), item.get("ocr_text"),
        ))))
        found = [word for word in keywords
                 if word.split() and all(_compact(w) in haystack for w in word.split())]
        match = {**(item.get("match") or {}), "interests": found}
        refreshed[key] = {**item, "match": match}
    return refreshed


def is_mine(judgement: dict | None, external: bool = False) -> bool:
    """Same rule as web/src/data.ts isMine: rule, literal interest, or Gemini relevant/maybe.
    External internship postings all say 인턴, so for them a keyword alone does not count (D-026)."""
    if not judgement:
        return False
    if external:
        ai = judgement.get("ai") or {}
        return bool(judgement.get("rule_name")) or ai.get("verdict") in ("relevant", "maybe")
    ai = judgement.get("ai") or {}
    interested = bool(judgement.get("interests"))
    if ai.get("verdict") == "not_relevant" and not interested:
        return False
    return bool(judgement.get("rule_name")) or interested or ai.get("verdict") in ("relevant", "maybe")
