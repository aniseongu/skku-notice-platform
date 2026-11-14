from datetime import UTC, datetime

import pytest

from skku_notice import push_collection as worker

NOW = datetime(2026, 11, 7, tzinfo=UTC)


def candidate(subscription_id="device", url="https://www.skku.edu/notice"):
    return {
        "user_id": "user",
        "subscription_id": subscription_id,
        "notice_id": "school/1",
        "title": "공지",
        "url": url,
        "endpoint": "https://fcm.googleapis.com/fcm/send/test",
        "p256dh": "public",
        "auth_secret": "private",
    }


class MemoryStore:
    def __init__(self, candidates):
        self.items = candidates
        self.claims = []
        self.marks = []
        self.removed = []

    def candidates(self):
        return self.items

    def claim(self, item):
        self.claims.append(item["subscription_id"])
        return None if item["subscription_id"] == "already" else len(self.claims)

    def mark(self, claim_id, status, now):
        self.marks.append((claim_id, status, now))

    def remove_expired(self, subscription_id, user_id):
        self.removed.append((subscription_id, user_id))


def test_batch_claims_before_send_and_handles_results(monkeypatch):
    store = MemoryStore([candidate("already"), candidate("sent"), candidate("expired"), candidate("retry")])
    outcomes = iter(["sent", "expired", "retry"])
    monkeypatch.setattr(worker, "send_one", lambda *_args, **_kwargs: next(outcomes))
    assert worker.run_batch(store, "key", "https://example.com", NOW) == {
        "sent": 1,
        "expired": 1,
        "retry": 1,
        "skipped": 1,
    }
    assert store.marks == [(2, "sent", NOW), (4, "failed", NOW)]
    assert store.removed == [("expired", "user")]


def test_invalid_notice_url_is_not_sent_and_claim_is_bounded(monkeypatch):
    store = MemoryStore(
        [candidate("invalid", "https://evil.invalid/")] + [candidate(str(i)) for i in range(30)]
    )
    calls = []
    monkeypatch.setattr(worker, "send_one", lambda *_args, **_kwargs: calls.append(1) or "sent")
    counts = worker.run_batch(store, "key", "https://example.com", NOW)
    assert counts["retry"] == 1 and counts["sent"] == 19
    assert len(store.claims) == 20 and len(calls) == 19
    assert store.marks[0] == (1, "failed", NOW)


def test_external_intern_notices_are_sent_to_each_candidates_device(monkeypatch):
    linkareer = {**candidate('device-a', 'https://linkareer.com/activity/12345'),
                 'user_id': 'user-a', 'notice_id': 'linkareer-intern/12345',
                 'endpoint': 'https://fcm.googleapis.com/fcm/send/device-a'}
    jasoseol = {**candidate('device-b', 'https://jasoseol.com/recruit/67890'),
                'user_id': 'user-b', 'notice_id': 'jasoseol-intern/67890',
                'endpoint': 'https://fcm.googleapis.com/fcm/send/device-b'}
    store = MemoryStore([linkareer, jasoseol])
    sent = []
    monkeypatch.setattr(worker, 'send_one', lambda subscription, *_args, **kw:
                        sent.append((subscription['endpoint'], kw['url'])) or 'sent')
    assert worker.run_batch(store, 'key', 'https://example.com', NOW)['sent'] == 2
    assert sent == [(linkareer['endpoint'], linkareer['url']), (jasoseol['endpoint'], jasoseol['url'])]
    assert store.marks == [(1, 'sent', NOW), (2, 'sent', NOW)]


@pytest.mark.parametrize('url', [
    'https://linkareer.com.evil.invalid/activity/1', 'https://evil.invalid@linkareer.com/activity/1',
    'http://linkareer.com/activity/1', 'https://linkareer.com:444/activity/1',
    'https://linkareer.com/activity/not-a-number', 'https://linkareer.com/redirect?url=https://evil.invalid',
    'https://jasoseol.com/recruit/1/extra', 'https://jasoseol.com.evil.invalid/recruit/1',
])
def test_unapproved_external_notice_urls_do_not_send(monkeypatch, url):
    store = MemoryStore([candidate('device', url)])
    sent = []
    monkeypatch.setattr(worker, 'send_one', lambda *_args, **_kwargs: sent.append(True))
    assert worker.run_batch(store, 'key', 'https://example.com', NOW)['retry'] == 1
    assert sent == []


def test_vapid_subject_is_normalized_to_what_py_vapid_accepts():
    from py_vapid import _check_sub

    assert worker.normalize_subject("https://example.pages.dev/") == "https://example.pages.dev"
    assert worker.normalize_subject(" mailto:admin@example.com ") == "mailto:admin@example.com"
    assert _check_sub(worker.normalize_subject("https://example.pages.dev/"))
    for bad in ("", "http://example.com", "https://", "https://example.com/path", "ftp://x.y"):
        with pytest.raises(ValueError):
            worker.normalize_subject(bad)


def test_message_puts_the_notice_title_first_and_never_says_only_new_notice():
    base = {"notice_id": "school/1", "title": "장학 안내", "source_name": "소프트웨어학과 공지"}
    # 학교 게시판 글은 제목 앞에 [게시판]을 붙이고(끝의 " 공지"는 뗀다) 본문에 게시판을 되풀이하지 않는다.
    assert worker.compose_message(base) == ("[소프트웨어학과] 장학 안내", "")
    # 첫 줄은 로그인 화면의 알림 예시와 같은 한 문장이다(이유와 마감).
    interested = {**base, "matched_words": ["인턴", "장학"], "deadline": "2026-11-09T14:59:00+00:00"}
    assert worker.compose_message(interested) == (
        "[소프트웨어학과] 장학 안내", "관심 키워드 인턴, 장학, 11월 9일(월) 마감이에요"
    )
    title, body = worker.compose_message(
        {**base, "kind": "changed", "change_kind": "제목", "deadline": "2026-11-09T03:30:00+00:00"}
    )
    assert title == "[소프트웨어학과] 장학 안내"
    assert body == "학교가 제목을 고쳤어요\n11월 9일(월) 오후 12시 30분 마감이에요"
    assert worker.compose_message({**base, "kind": "changed"})[1].startswith("학교가 본문을 고쳤어요")
    assert "새 공지" not in worker.compose_message({"notice_id": "school/2", "title": "t"})[1]


def test_new_notice_message_puts_the_ai_reason_first():
    base = {"notice_id": "school/1", "title": "장학 안내", "source_name": "소프트웨어학과 공지"}
    full = {**base, "ai_reason": "SW 개발 직무라 졸업요건에 맞아요", "matched_words": ["인턴"],
            "deadline": "2026-11-09T14:59:00+00:00"}
    assert worker.compose_message(full)[1] == (
        "SW 개발 직무라 졸업요건에 맞아요\n관심 키워드 인턴, 11월 9일(월) 마감이에요"
    )
    no_keyword = {k: v for k, v in full.items() if k != "matched_words"}
    assert worker.compose_message(no_keyword)[1] == (
        "SW 개발 직무라 졸업요건에 맞아요\n11월 9일(월) 마감이에요"
    )
    # 관련 없음·확인 필요 이유도 그대로 첫 줄에 간다. AI 문구가 없으면 키워드·마감 줄부터.
    reason_only = worker.compose_message({**base, "ai_reason": "기계 설비 업무예요"})
    assert reason_only[1] == "기계 설비 업무예요"
    assert worker.compose_message({**base, "ai_reason": None, "matched_words": ["인턴"]})[1] == (
        "관심 키워드 인턴"
    )
    # 수정됨 알림에는 AI 문구를 넣지 않는다.
    assert "SW" not in worker.compose_message({**full, "kind": "changed"})[1]


def test_changed_claim_carries_kind_and_marker():
    seen = {}

    class Store(worker.PushStore):
        def __init__(self):
            pass

        def _request(self, method, path, **kwargs):
            seen.update(kwargs["json"])

            class R:
                def json(self):
                    return 1

            return R()

    Store().claim({"user_id": "u", "subscription_id": "d", "notice_id": "s/1", "kind": "changed",
                   "change_marker": "2026-11-07T00:00:00+00:00"})
    assert seen["p_kind"] == "changed" and seen["p_change_marker"] == "2026-11-07T00:00:00+00:00"
    seen.clear()
    Store().claim({"user_id": "u", "subscription_id": "d", "notice_id": "s/1"})
    assert "p_kind" not in seen


def test_external_posting_message_carries_the_judgment_reason_before_the_deadline():
    candidate = {
        "notice_id": "linkareer-intern/1",
        "title": "[회사] 백엔드 인턴",
        "source_name": "링커리어",
        "ai_reason": "서버 개발 직무예요",
        "deadline": "2026-11-09T14:59:00+00:00",
    }
    assert worker.compose_message(candidate) == (
        "[회사] 백엔드 인턴",
        "서버 개발 직무예요\n11월 9일(월) 마감이에요\n링커리어",
    )


def test_device_canvas_mode_decides_which_alerts_a_device_gets():
    from skku_notice.push_collection import canvas_wanted

    matrix = {
        "off": {"summary": False, "deadline": False, "problem": False},
        "summary": {"summary": True, "deadline": False, "problem": True},
        "reminders": {"summary": True, "deadline": True, "problem": True},
        None: {"summary": True, "deadline": True, "problem": True},
    }
    for mode, kinds in matrix.items():
        for kind, wanted in kinds.items():
            assert canvas_wanted(mode, kind) is wanted, (mode, kind)


def test_feedback_mail_has_the_text_and_reply_to():
    from skku_notice.push_collection import feedback_mail

    row = {
        "kind": "bug", "body": "  로그인이   안 돼요\n두 번째 줄 ",
        "reply_email": "me@example.com", "created_at": "t",
    }
    mail = feedback_mail(row)
    assert mail["subject"] == "[성공 문의] 버그: 로그인이 안 돼요 두 번째 줄"
    assert "로그인이   안 돼요\n두 번째 줄" in mail["text"]
    assert "답장 메일: me@example.com" in mail["text"]
    assert mail["reply_to"] == "me@example.com"
    plain = feedback_mail({"kind": "idea", "body": "다크 모드", "reply_email": None, "created_at": "x"})
    assert "reply_to" not in plain and "답장할 수 없어요" in plain["text"]


def test_feedback_batch_marks_only_sent_rows_and_needs_key_and_address(monkeypatch):
    from datetime import UTC, datetime

    from skku_notice import push_collection as pc

    marked, posted = [], []

    class FakeStore:
        def feedback_pending(self):
            return [
                {"id": "f1", "kind": "question", "body": "하나"},
                {"id": "f2", "kind": "question", "body": "둘"},
                {"id": "f3", "kind": "question", "body": "셋", "reply_email": "a,b@c.de"},
            ]

        def mark_feedback(self, feedback_id, now):
            marked.append(feedback_id)

    class Response:
        def __init__(self, status):
            self.status_code = status

    def fake_post(url, headers, json, timeout):
        posted.append((url, headers["Authorization"], json["to"], json["subject"]))
        return Response({1: 200, 2: 500, 3: 422}.get(len(posted), 200))

    monkeypatch.setattr(pc.requests, "post", fake_post)
    now = datetime.now(UTC)
    sender = "성공 <onboarding@resend.dev>"
    counts = pc.run_feedback_batch(FakeStore(), "re_key", "owner@example.com", sender, now)
    # 1번은 보냄, 2번은 서버 오류라 다시, 3번은 글 때문에 거부(422)라 넘긴다(막힌 글이 뒤를 막지 않게).
    assert counts == {"feedback_sent": 1, "feedback_retry": 1, "feedback_dropped": 1}
    assert marked == ["f1", "f3"]
    assert posted[0][:3] == ("https://api.resend.com/emails", "Bearer re_key", ["owner@example.com"])

    class Untouched:
        def feedback_pending(self):
            raise AssertionError("읽지 않아야 한다")

    nothing = {"feedback_sent": 0, "feedback_retry": 0, "feedback_dropped": 0}
    assert pc.run_feedback_batch(Untouched(), "", "owner@example.com", "x", now) == nothing
    assert pc.run_feedback_batch(Untouched(), "re_key", "", "x", now) == nothing
    assert pc.run_feedback_batch(Untouched(), "re_key", "not-an-email", "x", now) == nothing


def test_reply_to_only_uses_plain_addresses():
    from skku_notice.push_collection import feedback_mail

    for bad in ["a,b@c.de", "x<y>@z.wx", "a b@c.de", "한글@도메인.한국", "a@b", "a@@b.cd"]:
        row = {"kind": "bug", "body": "x", "reply_email": bad, "created_at": "t"}
        assert "reply_to" not in feedback_mail(row), bad
    address = "first.last+tag@sub.example.co.kr"
    good = feedback_mail({"kind": "bug", "body": "x", "reply_email": address, "created_at": "t"})
    assert good["reply_to"] == address



def test_deadline_line_matches_the_login_example_and_handles_events():
    label = worker._deadline_label
    assert label("2026-12-05T14:59:00+00:00") == "12월 5일(토) 마감이에요"  # 23:59는 시각을 적지 않는다
    assert label("2026-12-05T09:00:00+00:00", "마감") == "12월 5일(토) 오후 6시 마감이에요"
    assert label("2026-12-09T05:00:00+00:00", "일정") == "12월 9일(수) 오후 2시 일정이에요"
    assert label("2026-12-09T00:00:00+00:00", "일정") == "12월 9일(수) 일정이에요"  # 시각 없는 일정(09:00)
    assert label("2026-12-09T01:30:00+00:00", "일정") == "12월 9일(수) 오전 10시 30분 일정이에요"


def test_school_notice_with_ai_deadline_reads_like_the_login_example():
    reason = "소프트웨어학과 학생이 지원할 수 있는 개발 인턴이에요"
    title, body = worker.compose_message({
        "notice_id": "cse/1", "source_name": "소프트웨어학과 공지",
        "title": "겨울방학 소프트웨어 인턴 모집 안내",
        "ai_reason": reason, "matched_words": ["인턴"], "kind": "new_notice",
        "deadline": "2026-12-05T14:59:00+00:00", "deadline_kind": "마감"})
    assert title == "[소프트웨어학과] 겨울방학 소프트웨어 인턴 모집 안내"
    assert body == f"{reason}\n관심 키워드 인턴, 12월 5일(토) 마감이에요"
