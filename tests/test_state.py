from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from skku_notice.model import Notice
from skku_notice.state import State, baseline, is_new, load_state, needs_delivery, record_result, save_state


def test_baseline_and_retry(tmp_path: Path) -> None:
    now = datetime(2026, 11, 2, 19, tzinfo=ZoneInfo("Asia/Seoul"))
    first = Notice("cse-notice", "123", "Title", None, "https://example.com", now.date(), False)
    second = Notice("skku-notice01", "123", "Title", None, "https://example.com", now.date(), False)
    state = baseline(State(), "cse-notice", [first], now)
    assert not is_new(state, first)
    assert is_new(state, second)
    assert not needs_delivery(state, first)
    assert state.sources["cse-notice"].seen["123"].status == "baseline"
    state = baseline(state, "skku-notice01", [], now)
    for expected_status in ("pending", "pending", "failed"):
        state = record_result(state, second, "pending", now)
        assert state.sources["skku-notice01"].seen["123"].status == expected_status
    assert not needs_delivery(state, second)
    path = tmp_path / "state.json"
    save_state(path, state)
    assert load_state(path) == state


def test_external_check_age_roundtrip_and_old_state(tmp_path: Path) -> None:
    from dataclasses import replace
    from datetime import timedelta

    from skku_notice.state import external_due

    now = datetime(2026, 11, 5, 12, tzinfo=ZoneInfo('Asia/Seoul'))
    path = tmp_path / 'state.json'
    path.write_text('{"version":1,"sources":{}}')
    state = load_state(path)
    assert external_due(state, 'jobs', now)
    state = replace(state, external_checked_at={'jobs': now.isoformat()})
    save_state(path, state)
    state = load_state(path)
    assert not external_due(state, 'jobs', now + timedelta(minutes=59))
    assert external_due(state, 'jobs', now + timedelta(hours=1))
    assert external_due(state, 'jobs', now - timedelta(minutes=1))
    assert external_due(replace(state, external_checked_at={'jobs': 'invalid'}), 'jobs', now)
