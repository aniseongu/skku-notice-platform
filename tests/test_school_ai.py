

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
