# ruff: noqa: E501
import json
from types import SimpleNamespace

from skku_notice import intern_ai
from skku_notice.fetch import ImageData


def test_intern_judgment_sends_complete_body_and_linked_image_bytes():
    calls = []

    def generate_content(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(text=json.dumps({"items": [
            {"id": "jobs/1", "verdict": "relevant", "reason": "개발 직무예요"},
            {"id": "unknown", "verdict": "relevant", "reason": "무시"},
        ]}, ensure_ascii=False))

    client = SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))
    body = "모집 분야 및 자격 " * 1000
    items = [{"id": "jobs/1", "title": "인턴 모집", "body": body}]
    images = {"jobs/1": [ImageData(b"public-image-bytes", "image/png")]}
    result = intern_ai.judge_internships(items, "model", "fake", images=images, client=client)
    assert set(result) == {"jobs/1"} and result["jobs/1"].verdict == "relevant"
    parts = calls[0]["contents"]
    payload = json.loads(parts[0].text)
    assert payload["postings"][0]["body"] == body
    assert json.loads(parts[1].text)["image_for"] == "jobs/1"
    assert parts[2].inline_data.data == b"public-image-bytes"
    assert "로고" in calls[0]["config"].system_instruction


def test_invalid_api_response_or_error_makes_no_decision():
    items = [{"id": "jobs/1", "title": "인턴", "body": "공개 본문"}]
    for text in (None, "invalid", '{"items": []}'):
        client = SimpleNamespace(models=SimpleNamespace(
            generate_content=lambda text=text, **_: SimpleNamespace(text=text),
        ))
        assert intern_ai.judge_internships(items, "model", "fake", client=client) == {}
    assert intern_ai.judge_internships(items, "model", "") == {}


def item(number, *, body="모집분야: 개발자", images=None):
    return {"notice": {"id": f"jobs/{number}", "source_id": "jobs", "article_no": str(number),
                       "title": "일반 인턴 모집"}, "body_text": body, "images": images or [],
            "match": {"ai": None, "priority": None}}








def test_policy_change_invalidates_cached_intern_judgments(monkeypatch):
    before = intern_ai.intern_fingerprint("인턴", "전기 전자 우대", [], "m", {})
    monkeypatch.setattr(intern_ai, "SYSTEM", intern_ai.SYSTEM + "새로운 판정 기준")
    after = intern_ai.intern_fingerprint("인턴", "전기 전자 우대", [], "m", {})
    assert before != after


def test_other_major_preferences_are_not_shown_as_personal_advantage():
    neutral = "담당 업무와 지원 자격을 원문에서 확인해 주세요"
    assert intern_ai.preference_safe_reason("전기, 전자 전공자를 우대해요") == neutral
    assert intern_ai.preference_safe_reason("수학, 통계 전공자를 우대해요") == neutral
    assert intern_ai.preference_safe_reason("컴퓨터공학 전공을 우대해요") == "컴퓨터공학 전공을 우대해요"
    skills = "SQL과 Python 활용 능력을 우대해요"
    assert intern_ai.preference_safe_reason(skills) == skills


def test_major_preference_distinguishes_required_and_other_majors():
    neutral = "담당 업무와 지원 자격을 원문에서 확인해 주세요"
    assert intern_ai.preference_safe_reason("컴퓨터공학 전공 필수, 전기전자 전공 우대") == neutral
    assert intern_ai.preference_safe_reason("컴퓨터공학 지식과 전기전자 전공 우대") == neutral
    assert intern_ai.preference_safe_reason("전기전자공학 우대") == neutral
    assert intern_ai.preference_safe_reason("우대 전공: 전기, 전자") == neutral
    assert intern_ai.preference_safe_reason("우대 전공: 전기전자") == neutral
    assert intern_ai.preference_safe_reason("전자상거래 개발, IT 관련 전공 우대") != neutral
    assert intern_ai.preference_safe_reason("컴퓨터공학 전공과 전자공학 전공 우대") != neutral


def test_noncomputer_preference_alone_does_not_establish_development_fit():
    verdict, reason = intern_ai.preference_safe_decision(
        "relevant", "수학, 통계 전공자를 우대하며 VBA를 활용해요"
    )
    assert verdict == "maybe"
    assert reason == "담당 업무와 지원 자격을 원문에서 확인해 주세요"
    verdict, _ = intern_ai.preference_safe_decision(
        "relevant", "소프트웨어 개발 직무이며 전자 전공을 우대해요"
    )
    assert verdict == "relevant"


def test_external_postings_get_a_korean_summary_like_school_notices():
    # 현장실습·인턴 공고도 학교 공지처럼 요약을 저장한다. 영어만 있는 요약은 저장하지 않는다.
    def generate_content(**kwargs):
        generate_content.config = kwargs["config"]
        return SimpleNamespace(text=json.dumps({"items": [
            {"id": "coop/1", "verdict": "relevant", "reason": "SW 개발 실습이에요",
             "summary": "한국전자에서 백엔드 개발 실습생을 뽑아요.\n12월 1일까지 톨게이트에서 신청해요."},
            {"id": "coop/2", "verdict": "maybe", "reason": "직무를 확인해 주세요",
             "summary": "Hiring backend interns."},
        ]}, ensure_ascii=False))

    client = SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))
    items = [{"id": "coop/1", "title": "현장실습", "body": "본문"},
             {"id": "coop/2", "title": "Intern", "body": "body"}]
    result = intern_ai.judge_internships(items, "model", "fake", client=client)
    expected = "한국전자에서 백엔드 개발 실습생을 뽑아요.\n12월 1일까지 톨게이트에서 신청해요."
    assert result["coop/1"].summary == expected
    assert result["coop/2"].summary is None
    assert "summary는 해요체" in generate_content.config.system_instruction
    assert "summary" in intern_ai.SCHEMA["properties"]["items"]["items"]["required"]


def test_formal_endings_become_haeyo_before_saving():
    from skku_notice.judge import clean_reason, haeyo
    assert haeyo("실습생을 모집합니다.\n09:00~18:00입니다.\n확정됩니다.") == "실습생을 모집해요.\n09:00~18:00이에요.\n확정돼요."
    assert haeyo("신청 안내입니다.") == "신청 안내예요." and haeyo("참고하시기 바랍니다.") == "참고해 주세요."
    assert haeyo("합격자를 발표했습니다.") == "합격자를 발표했어요." and haeyo("링크를 받습니다.") == "링크를 받아요."
    assert haeyo("이미 해요체예요.") == "이미 해요체예요."
    assert clean_reason("소프트웨어 관련 역량을 활용할 수 있는 직무입니다.") == "소프트웨어 관련 역량을 활용할 수 있는 직무예요."
    assert intern_ai.clean_summary("기관이 개발자를 모집합니다.") == "기관이 개발자를 모집해요."
