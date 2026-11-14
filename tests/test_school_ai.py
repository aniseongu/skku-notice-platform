# ruff: noqa: E501


def test_an_event_date_before_today_is_dropped_but_a_deadline_stays_for_a_week():
    from datetime import UTC, datetime, timedelta

    from skku_notice import school_ai
    from skku_notice.deadline import KST

    now = datetime.now(UTC).astimezone(KST)
    yesterday = (now - timedelta(days=1)).replace(hour=9, minute=0).isoformat()
    tomorrow = (now + timedelta(days=1)).replace(hour=9, minute=0).isoformat()
    assert school_ai._valid_deadline(yesterday, "일정") is None
    assert school_ai._valid_deadline(yesterday, "마감") is not None
    assert school_ai._valid_deadline(tomorrow, "일정") is not None
    assert school_ai._valid_deadline(now.replace(hour=0, minute=1).isoformat(), "일정") is not None
    assert school_ai._valid_deadline("not a date", "일정") is None


def test_english_reply_is_replaced_with_korean_fallback_and_english_summary_is_dropped():
    import json
    from types import SimpleNamespace

    from skku_notice import school_ai
    from skku_notice.judge import FALLBACK_REASON, LANGUAGE_RULE, SUMMARY_FORMAT

    seen = {}

    class Client:
        class models:  # noqa: N801
            @staticmethod
            def generate_content(model, contents, config):
                seen["system"] = config.system_instruction
                return SimpleNamespace(text=json.dumps({"items": [
                    {"id": "a", "verdict": "relevant", "reason": "Open to all students", "summary": "Apply by Dec 5.",
                     "deadline_kind": "없음", "deadline_at": ""},
                    {"id": "b", "verdict": "maybe", "reason": "전체 학생이 신청할 수 있어요", "summary": "12월 5일까지 신청해요.",
                     "deadline_kind": "없음", "deadline_at": ""}]}))

    out = school_ai.judge_school_notices(
        [{"id": "a", "title": "Global Internship", "body": "x"}, {"id": "b", "title": "t", "body": "y"}], "m", "k", client=Client())
    assert seen["system"] == school_ai.SYSTEM + LANGUAGE_RULE + SUMMARY_FORMAT
    assert out["a"].reason == FALLBACK_REASON and out["a"].summary is None
    assert out["b"].summary == "12월 5일까지 신청해요."


def test_language_rule_is_not_part_of_the_intern_fingerprint():
    from skku_notice import intern_ai
    from skku_notice.judge import LANGUAGE_RULE

    assert LANGUAGE_RULE not in intern_ai.SYSTEM
