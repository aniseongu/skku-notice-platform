# 출처: https://github.com/hg111911190-sketch/skku-notice/blob/main/test_jobs_rules.py
from datetime import date
from pathlib import Path

from skku_notice.model import Notice
from skku_notice.rules import Rule, Ruleset, load_rules, match_notice


def notice(title: str, category: str = "장학", source_id: str = "skku-notice01") -> Notice:
    return Notice(
        source_id,
        "123",
        title,
        category,
        "https://example.com/?mode=view&articleNo=123",
        date(2026, 11, 2),
        False,
    )


def test_example_rules_first_match_and_exclusions() -> None:
    ruleset = load_rules(Path("config/rules.example.yaml"))
    matched = match_notice(notice("인턴 장학 신청"), ruleset)
    assert matched is not None
    assert (matched.rule_name, matched.priority, matched.reasons) == ("장학", "high", ("category:장학",))
    assert match_notice(notice("대학원생 대상 장학"), ruleset) is None
    assert match_notice(notice("공고", "일반"), ruleset) is None
    assert match_notice(notice("공고", "일반", "cse-notice"), ruleset) is None
    assert ruleset.notify_all is True


def test_rule_conditions() -> None:
    ruleset = Ruleset(
        (),
        (
            Rule(
                "target",
                categories=("취업",),
                title_any=("INTERN", "인턴"),
                title_none=("마감",),
                sources=("cse-notice",),
                title_regex=r"2026",
            ),
        ),
    )
    assert match_notice(notice("2026 intern 모집", "취업", "cse-notice"), ruleset) is not None
    assert match_notice(notice("2026 intern 마감", "취업", "cse-notice"), ruleset) is None
    assert match_notice(notice("2026 intern 모집", "취업"), ruleset) is None
    assert match_notice(notice("2026 intern 모집", "장학", "cse-notice"), ruleset) is None
    assert match_notice(notice("2026 채용 모집", "취업", "cse-notice"), ruleset) is None
    assert match_notice(notice("2025 intern 모집", "취업", "cse-notice"), ruleset) is None
