# ruff: noqa: E501  (한국어 문구와 상태 열 이름이 한 줄에 있다)
import sys
from datetime import UTC, datetime, timedelta

from skku_notice import canvas_worker as worker
from skku_notice.byok_crypto import b64encode, encrypt_api_key
from skku_notice.canvas import CanvasError
from skku_notice.canvas_alerts import CanvasItem

MASTER = b64encode(b"k" * 32)
NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
TOKEN = "1234~" + "T" * 40


def row(user="user-a", state=None, last_run_at=None, secret=TOKEN):
    return {
        "user_id": user,
        "ciphertext": encrypt_api_key(MASTER, f"{user}:canvas", secret, b"i" * 12),
        "state": state or {},
        "last_run_at": last_run_at,
    }


class Store:
    def __init__(self, rows):
        self.rows, self.updates, self.alerts = rows, [], []

    def tokens(self):
        return self.rows

    def update(self, user_id, fields):
        self.updates.append((user_id, fields))

    def add_alerts(self, user_id, alerts):
        self.alerts.extend((user_id, a) for a in alerts)


def item(hours=2.0):
    return CanvasItem("k1", "과제 1", "소프트웨어공학", "과제", NOW + timedelta(hours=hours), "https://canvas.skku.edu/x")


def reader(items=(), incomplete=False, error=None, noise=""):
    def read(token, now, reserve_learningx=None, on_incomplete=None):
        assert token == TOKEN
        if reserve_learningx:
            reserve_learningx()
        if noise:
            print(noise, file=sys.stderr)
        if error:
            raise error
        if incomplete and on_incomplete:
            on_incomplete()
        return list(items)
    return read


def test_first_read_only_records_existing_items_without_alerting():
    store = Store([row()])
    assert worker.process_user(store, MASTER, store.rows[0], NOW, reader([item()])) == "ok"
    assert store.alerts == []
    fields = store.updates[-1][1]
    assert fields["state"]["initialized"] is True and fields["last_reason"] is None
    assert any("k1|m180" in key for key in fields["state"]["notified"])


def test_later_reads_queue_deadline_alerts_once():
    first = Store([row()])
    worker.process_user(first, MASTER, first.rows[0], NOW, reader([]))
    state = first.updates[-1][1]["state"]
    second = Store([row(state=state)])
    worker.process_user(second, MASTER, second.rows[0], NOW + timedelta(hours=2), reader([item(3.0)]))
    titles = [a.title for _, a in second.alerts]
    assert any("마감까지" in title for title in titles)
    third = Store([row(state=second.updates[-1][1]["state"])])
    worker.process_user(third, MASTER, third.rows[0], NOW + timedelta(hours=2, minutes=30), reader([item(3.0)]))
    assert [a for _, a in third.alerts if "마감까지" in a.title] == []


def test_incomplete_reads_record_the_reason_and_use_the_partial_summary_wording():
    state = {"initialized": True, "notified": {}}
    store = Store([row(state=state)])
    late = datetime(2026, 11, 7, 13, 0, tzinfo=UTC)  # 22:00 KST, after the summary time
    noise = "강의 조회 대기: 강의 API HTTP 403"
    assert worker.process_user(store, MASTER, store.rows[0], late, reader([item()], incomplete=True, noise=noise)) == "partial"
    fields = store.updates[-1][1]
    assert "강의 API HTTP 403" in fields["last_reason"] and TOKEN not in fields["last_reason"]
    summary = [a for _, a in store.alerts if "마감" in a.title or "확인하지 못했어요" in a.title]
    assert any(a.title == worker.INCOMPLETE_TITLE for a in summary)
    assert fields["state"]["partial_summary_sent_on"] == "2026-11-07"
    assert fields["state"]["summary_sent_on"] is None


def test_rejected_token_disables_the_row_and_queues_one_notice():
    store = Store([row()])
    assert worker.process_user(store, MASTER, store.rows[0], NOW, reader(error=CanvasError("토큰 거절"))) == "rejected"
    fields = store.updates[-1][1]
    assert fields["disabled_at"] and "다시 등록" in fields["last_error"]
    assert [a.title for _, a in store.alerts] == ["아이캠퍼스 연결이 끊겼어요"]
    assert TOKEN not in str(store.updates) + str(store.alerts)


def test_other_failures_keep_the_token_and_never_leak_it():
    store = Store([row()])
    error = CanvasError(f"Canvas 응답 오류 {TOKEN}")
    assert worker.process_user(store, MASTER, store.rows[0], NOW, reader(error=error)) == "error"
    fields = store.updates[-1][1]
    assert "disabled_at" not in fields and TOKEN not in str(fields)


def test_a_token_moved_to_another_user_is_disabled_and_never_sent():
    moved = row("user-b")
    moved["ciphertext"] = row("user-a")["ciphertext"]
    store = Store([moved])
    assert worker.process_user(store, MASTER, moved, NOW, reader()) == "error"
    assert store.updates[0][1]["disabled_at"] and store.alerts == []


def test_each_user_runs_at_most_once_per_hour():
    recent = (NOW - timedelta(minutes=30)).isoformat()
    store = Store([row(last_run_at=recent), row("user-c", last_run_at=(NOW - timedelta(hours=2)).isoformat())])
    # user-c's ciphertext is bound to its own id, so the same fake token works for it
    counts = worker.run(store, MASTER, NOW, reader())
    assert counts["skipped"] == 1 and counts["ok"] == 1
