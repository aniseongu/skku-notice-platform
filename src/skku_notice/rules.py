# 출처: https://github.com/hg111911190-sketch/skku-notice/blob/main/jobs_rules.py
"""Apply the first matching YAML rule to a notice."""

import re
from dataclasses import dataclass
from pathlib import Path

import yaml

from skku_notice.model import Match, Notice


@dataclass(frozen=True)
class Rule:
    name: str
    priority: str = "default"
    categories: tuple[str, ...] = ()
    title_any: tuple[str, ...] = ()
    title_none: tuple[str, ...] = ()
    sources: tuple[str, ...] = ()
    title_regex: str | None = None


@dataclass(frozen=True)
class Ruleset:
    exclude_title: tuple[str, ...]
    rules: tuple[Rule, ...]
    notify_all: bool = False


def load_rules(path: Path) -> Ruleset:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("rules"), list):
        raise ValueError("rules YAML must contain a rules list")
    rules = []
    for item in data["rules"]:
        if not isinstance(item, dict) or not item.get("name"):
            raise ValueError("each rule needs a name")
        regex = item.get("title_regex")
        if regex is not None:
            re.compile(regex)
        priority = item.get("priority", "default")
        if priority not in {"high", "default", "low"}:
            raise ValueError(f"invalid priority: {priority}")
        rules.append(
            Rule(
                name=item["name"],
                priority=priority,
                categories=tuple(item.get("categories") or ()),
                title_any=tuple(item.get("title_any") or ()),
                title_none=tuple(item.get("title_none") or ()),
                sources=tuple(item.get("sources") or ()),
                title_regex=regex,
            )
        )
    notify_all = data.get("notify_all", False)
    if not isinstance(notify_all, bool):
        raise ValueError("notify_all must be a boolean")
    return Ruleset(tuple(data.get("exclude_title") or ()), tuple(rules), notify_all)


def _normalized(value: str) -> str:
    return value.strip().casefold()


def match_notice(notice: Notice, ruleset: Ruleset) -> Match | None:
    title = _normalized(notice.title)
    if any(_normalized(word) in title for word in ruleset.exclude_title):
        return None
    for rule in ruleset.rules:
        reasons = []
        if rule.sources:
            if notice.source_id not in rule.sources:
                continue
            reasons.append(f"source:{notice.source_id}")
        if rule.categories:
            category = _normalized(notice.category or "")
            if category not in {_normalized(value) for value in rule.categories}:
                continue
            reasons.append(f"category:{notice.category}")
        if rule.title_any:
            word = next((word for word in rule.title_any if _normalized(word) in title), None)
            if word is None:
                continue
            reasons.append(f"title_any:{word}")
        if any(_normalized(word) in title for word in rule.title_none):
            continue
        if rule.title_regex:
            found = re.search(rule.title_regex, notice.title, flags=re.IGNORECASE)
            if found is None:
                continue
            reasons.append(f"title_regex:{found.group()}")
        return Match(notice, rule.name, rule.priority, tuple(reasons))
    return None
