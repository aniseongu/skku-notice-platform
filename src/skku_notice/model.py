from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Notice:
    source_id: str
    article_no: str
    title: str
    category: str | None
    url: str
    posted_on: date
    pinned: bool


@dataclass(frozen=True)
class Match:
    notice: Notice
    rule_name: str
    priority: str
    reasons: tuple[str, ...]
