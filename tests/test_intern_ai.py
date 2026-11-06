import json
from types import SimpleNamespace

from skku_notice import cli, intern_ai
from skku_notice.archive import Archive
from skku_notice.fetch import ImageData
from skku_notice.judge import Judgment
from skku_notice.state import SeenRecord, SourceState, State


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


def test_intern_judgment_receives_eligibility_profile(monkeypatch, tmp_path):
    received = []
    monkeypatch.setattr(cli, "ARCHIVE_PATH", tmp_path / "archive.json")
    monkeypatch.setattr(
        cli, "judge_internships", lambda *args, **kwargs: received.append(kwargs["profile"]) or {}
    )
    cli._intern_decisions(
        Archive({"jobs/1": item(1)}), State({}), [{"id": "jobs", "external": True}],
        {"model": "m"}, "fake", [10], "test",
        {"year": 2, "semester": 2, "enrolled_semester": 4,
         "military_service": "복무 완료", "name": "private"},
    )
    assert received == [{"year": 2, "semester": 2, "enrolled_semester": 4, "military_service": "복무 완료"}]


def test_backfill_prioritizes_pending_limits_to_six_and_caches(monkeypatch, tmp_path):
    stamp = "2026-11-04T00:00:00+09:00"
    state = State({"jobs": SourceState(stamp, {str(i): SeenRecord(stamp, "baseline", 0) for i in range(8)} | {
        "7": SeenRecord(stamp, "pending", 0)})})
    archive = Archive({f"jobs/{i}": item(i) for i in range(8)})
    calls = []

    def judge(items, *_args, **_kwargs):
        calls.append(items)
        return {entry["id"]: Judgment("relevant", "개발 직무예요", "m") for entry in items}

    monkeypatch.setattr(cli, "ARCHIVE_PATH", tmp_path / "archive.json")
    monkeypatch.setattr(cli, "judge_internships", judge)
    sources = [{"id": "jobs", "external": True}]
    archive, found = cli._intern_decisions(archive, state, sources, {"model": "m"}, "fake", [10], "test")
    assert len(calls[0]) == 6 and calls[0][0]["id"] == "jobs/7"
    assert len(found) == 6 and state.sources["jobs"].seen["0"].status == "baseline"
    assert archive.items["jobs/0"]["match"]["ai"]["reason"] == "개발 직무예요"
    archive, found = cli._intern_decisions(archive, state, sources, {"model": "m"}, "fake", [10], "test")
    assert len(calls) == 2 and len(calls[1]) == 2 and len(found) == 8
    archive, _ = cli._intern_decisions(archive, state, sources, {"model": "m"}, "fake", [10], "test")
    assert len(calls) == 2
    changed = dict(archive.items)
    changed["jobs/0"] = {**changed["jobs/0"], "body_text": "변경된 모집 분야"}
    cli._intern_decisions(Archive(changed), state, sources, {"model": "m"}, "fake", [10], "test")
    assert len(calls) == 3 and calls[2][0]["id"] == "jobs/0"


def test_image_only_intern_waits_when_image_cannot_be_fetched(monkeypatch, tmp_path):
    archive = Archive({"jobs/1": item(1, body="", images=["https://cdn.example/image.png"])})
    state = State({"jobs": SourceState("time", {})})
    calls = []
    monkeypatch.setattr(cli, "ARCHIVE_PATH", tmp_path / "archive.json")
    monkeypatch.setattr(cli.time, "sleep", lambda _: None)
    monkeypatch.setattr(cli, "fetch_images", lambda *args, **kwargs: [])
    monkeypatch.setattr(cli, "judge_internships", lambda *args, **kwargs: calls.append(args) or {})
    _, found = cli._intern_decisions(archive, state, [{"id": "jobs", "external": True}],
                                    {"model": "m"}, "fake", [10], "test")
    assert not found and not calls
    pixels = ImageData(b"public-image", "image/png")
    monkeypatch.setattr(cli, "fetch_images", lambda *args, **kwargs: [pixels])
    received = []

    def judge(items, *_args, **kwargs):
        received.append(kwargs["images"])
        return {"jobs/1": Judgment("maybe", "이미지를 확인해 주세요", "m")}

    monkeypatch.setattr(cli, "judge_internships", judge)
    budget = [2]
    _, found = cli._intern_decisions(archive, state, [{"id": "jobs", "external": True}],
                                    {"model": "m"}, "fake", budget, "test")
    assert budget == [1] and found["jobs/1"].verdict == "maybe"
    assert received == [{"jobs/1": [pixels]}]


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
