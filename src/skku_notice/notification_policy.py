"""Notification eligibility for school posts and Gemini-classified internships."""

import re

from skku_notice.judge import Judgment, decide_priority
from skku_notice.model import Match


def is_internship(title: str) -> bool:
    return "인턴" in title or bool(re.search(r"\bintern(?:ship|ships|s)?\b", title, re.IGNORECASE))


def alert_priority(
    *, external: bool, title: str, body: str, match: Match | None,
    judgment: Judgment | None, interests: tuple[str, ...],
) -> str | None:
    """Notify every school post; only Gemini-relevant internships qualify."""
    if external:
        return "default" if judgment and judgment.verdict == "relevant" else None
    if is_internship(title) and judgment and judgment.verdict == "not_relevant":
        return None
    return decide_priority(match, judgment, interests) or "low"
