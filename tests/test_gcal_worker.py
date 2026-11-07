# ruff: noqa: E501  (모의 구글 응답과 한국어 문구가 한 줄에 있다)
from datetime import UTC, datetime, timedelta

import httpx

from skku_notice import gcal_worker as worker
from skku_notice.byok_crypto import b64encode, encrypt_api_key

MASTER = b64encode(b"k" * 32)
NOW = datetime(2026, 11, 8, 3, 0, tzinfo=UTC)
REFRESH = "1//0g" + "R" * 60


def token_row(user="user-a", secret=REFRESH, last_run_at=None):
    return {"user_id": user, "ciphertext": encrypt_api_key(MASTER, f"{user}:gcal", secret, b"i" * 12), "last_run_at": last_run_at}


class Store:
    def __init__(self, notices=(), judgments=(), calendar="cal@group.calendar.google.com", external=()):
        self._notices, self._judgments, self._calendar, self._external = list(notices), list(judgments), calendar, frozenset(external)
        self.updates, self.synced_at = [], []

    def tokens(self): return []
    def calendar_id(self, user_id): return self._calendar
    def saved_notices(self, user_id): return self._notices
    def judgments(self, user_id, ids): return [j for j in self._judgments if j["notice_id"] in ids]
    def external_sources(self): return self._external
    def update(self, user_id, fields): self.updates.append((user_id, fields))
    def synced(self, user_id, stamp): self.synced_at.append((user_id, stamp))


def notice(i, deadline="2026-11-10T14:59:00+00:00", title=None, source="skku-notice01"):
    return {"id": f"{source}/{i}", "source_id": source, "title": title or f"공지 {i}", "url": f"https://www.skku.edu/{i}", "deadline": deadline, "category": "학사"}


def google(refresh_ok=True, events=None, seen=None):
    """토큰 갱신과 캘린더 일정 API를 흉내 낸다."""
    seen = seen if seen is not None else []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, request.url.host, request.url.path))
        if request.url.host == "oauth2.googleapis.com":
            body = request.content.decode()
            assert "refresh_token=" in body and "client_secret=" in body
            return httpx.Response(200, json={"access_token": "ya29.test"}) if refresh_ok else httpx.Response(400, json={"error": "invalid_grant"})
        assert request.headers["Authorization"] == "Bearer ya29.test"
        if request.method == "GET":
            return httpx.Response(200, json={"items": events or []})
        return httpx.Response(200, json={})

    def factory(**kwargs):
        return httpx.Client(transport=httpx.MockTransport(handler), **kwargs)

    return factory, seen


def test_saved_notices_become_marked_events_and_nothing_secret_is_printed(capsys):
    store = Store([notice(1), notice(2, deadline=None)])
    factory, seen = google()
    assert worker.process_user(store, MASTER, "cid", "csecret", token_row(), NOW, factory) == "ok"
    writes = [call for call in seen if call[0] == "POST" and call[1] == "www.googleapis.com"]
    assert len(writes) == 1                                           # 마감이 있는 한 건만 넣는다
    assert store.synced_at and store.updates[-1][1]["last_error"] is None
    printed = capsys.readouterr().out
    assert REFRESH not in printed and "csecret" not in printed and "ya29" not in printed


def test_a_deadline_the_users_gemini_read_fills_in_and_not_relevant_internships_are_left_out():
    notices = [notice(1, deadline=None), notice(2, title="[회사] 개발 인턴 모집", source="linkareer-intern"), notice(3, title="[회사] 마케팅 인턴 모집", source="linkareer-intern")]
    judgments = [
        {"notice_id": "skku-notice01/1", "verdict": "relevant", "deadline": "2026-11-12T14:59:00+00:00", "deadline_kind": "마감"},
        {"notice_id": "linkareer-intern/2", "verdict": "relevant", "deadline": None, "deadline_kind": None},
        {"notice_id": "linkareer-intern/3", "verdict": "not_relevant", "deadline": None, "deadline_kind": None},
    ]
    store = Store(notices, judgments, external={"linkareer-intern"})
    desired = worker.build_desired(store, "user-a", NOW)
    privates = sorted(event["extendedProperties"]["private"]["skkuNotice"] for event in desired.values())
    # 제목에 날짜가 없어도 내 Gemini가 읽은 마감으로 들어가고, 맞지 않다고 판정한 인턴 공고(3번)는 뺀다.
    assert privates == ["linkareer-intern/2", "skku-notice01/1"]


def test_a_broken_google_connection_stops_the_row_with_a_plain_reason():
    store = Store([notice(1)])
    factory, _ = google(refresh_ok=False)
    assert worker.process_user(store, MASTER, "cid", "csecret", token_row(), NOW, factory) == "error"
    fields = store.updates[-1][1]
    assert fields["disabled_at"] and "다시 연결" in fields["last_error"]
    assert store.synced_at == []


def test_no_calendar_yet_is_skipped_and_a_moved_ciphertext_is_never_used():
    factory, seen = google()
    assert worker.process_user(Store(calendar=None), MASTER, "cid", "csecret", token_row(), NOW, factory) == "skipped"
    assert seen == []
    moved = token_row("user-b")
    moved["ciphertext"] = token_row("user-a")["ciphertext"]            # 다른 사용자 행으로 옮긴 암호문
    store = Store([notice(1)])
    assert worker.process_user(store, MASTER, "cid", "csecret", moved, NOW, factory) == "error"
    assert store.updates[0][1]["disabled_at"] and seen == []


def test_each_user_is_synced_at_most_every_25_minutes():
    class Many(Store):
        def tokens(self):
            return [token_row("user-a", last_run_at=(NOW - timedelta(minutes=10)).isoformat()),
                    token_row("user-b", last_run_at=(NOW - timedelta(hours=2)).isoformat()),
                    token_row("user-c")]
    factory, _ = google()
    counts = worker.run(Many([notice(1)]), MASTER, "cid", "csecret", NOW, factory)
    assert counts == {"ok": 2, "skipped": 0, "error": 0, "waiting": 1}
