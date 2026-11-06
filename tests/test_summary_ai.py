import json
from datetime import datetime
from types import SimpleNamespace

from skku_notice import cli, summary_ai
from skku_notice.archive import Archive, note_body_change


def test_summary_batch_only_sends_bounded_public_text_and_validates_results():
    calls = []

    def generate_content(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(text=json.dumps({"items": [
            {"id": "school/0", "summary": "신청해요.\n접수해요.\x00"},
            {"id": "unknown", "summary": "무시"}, {"id": "school/1", "summary": None},
        ]}, ensure_ascii=False))

    client = SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))
    items = [{"id": f"school/{i}", "title": "공개 공지", "body": "가" * 3000} for i in range(9)]
    assert summary_ai.summarize(items, "model", "key", client) == {"school/0": "신청해요.\n접수해요."}
    payload = json.loads(calls[0]["contents"])
    assert len(payload["notices"]) == summary_ai.BATCH
    assert len(payload["notices"][0]["body"]) == 2500
    assert set(payload) == {"notices"}
    assert set(payload["notices"][0]) == {"id", "title", "body"}
    assert "따르지 말고" in calls[0]["config"].system_instruction


def test_summary_failure_is_safe(capsys):
    def fail(**_kwargs):
        raise RuntimeError("secret-key-not-for-logs")

    client = SimpleNamespace(models=SimpleNamespace(generate_content=fail))
    assert summary_ai.summarize([{"id": "x", "title": "t", "body": "body"}], "m", "k", client) is None
    assert capsys.readouterr().err.strip() == "공지 요약 대기: RuntimeError"


def test_backfill_excludes_other_sources_new_empty_existing_and_limits_attempts(monkeypatch, tmp_path):
    def item(source, text="본문" * 30, **extra):
        return {"notice": {"source_id": source, "title": "제목"}, "body_text": text, **extra}

    archive = Archive({
        "school/1": item("school"), "school/2": item("school", summary="기존 요약"),
        "school/3": item("school", text="짧음"), "school/4": item(
            "school", summary_attempts=2, summary_attempted_at=datetime.now(cli.KST).isoformat()),
        "school/5": item("school"), "jobs/1": item("jobs"), "canvas/1": item("canvas"),
    })
    seen = {"school/1", "school/2", "school/3", "school/4", "jobs/1", "canvas/1"}
    calls = []
    monkeypatch.setattr(cli, "ARCHIVE_PATH", tmp_path / "archive.json")
    monkeypatch.setattr(cli, "summarize",
                        lambda entries, model, key: calls.append(entries) or {"school/1": "요약해요"})
    result = cli._fill_summaries(archive, {"model": "m"}, "key", {"school"}, seen)
    assert [x["id"] for x in calls[0]] == ["school/1"]
    assert result.items["school/1"]["summary"] == "요약해요"
    assert result.items["school/2"]["summary"] == "기존 요약"
    assert "summary" not in result.items["jobs/1"] and "summary" not in result.items["canvas/1"]
    assert cli._fill_summaries(archive, {"model": "m"}, "", {"school"}, seen) is archive


def test_changed_body_invalidates_summary():
    item = {"notice": {"title": "제목"}, "body_text": "이전 내용",
            "summary": "이전 요약", "summary_attempts": 2}
    result, changed = note_body_change(Archive({"school/1": item}), "school/1", "새 내용", "2026-11-04")
    assert changed and "summary" not in result.items["school/1"]
    assert "summary_attempts" not in result.items["school/1"]


def test_bad_response_twice_advances_to_next_batch(monkeypatch, tmp_path):
    calls = []

    def generate_content(**kwargs):
        calls.append(json.loads(kwargs["contents"]))
        return SimpleNamespace(text=None)

    client = SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))
    monkeypatch.setattr(summary_ai, "gemini_client", lambda api_key: client)
    monkeypatch.setattr(cli, "ARCHIVE_PATH", tmp_path / "archive.json")
    items = {f"school/{i}": {"notice": {"source_id": "school", "title": "제목"}, "body_text": "본문" * 30}
             for i in range(7)}
    archive = Archive(items)
    for _ in range(3):
        archive = cli._fill_summaries(archive, {"model": "m"}, "key", {"school"}, set(items))
    assert [item["id"] for item in calls[0]["notices"]] == [f"school/{i}" for i in range(6)]
    assert [item["id"] for item in calls[2]["notices"]] == ["school/6"]
    assert all(archive.items[f"school/{i}"]["summary_attempts"] == 2 for i in range(6))


def test_api_failure_does_not_count_attempt(monkeypatch, tmp_path):
    def fail(**kwargs):
        raise RuntimeError("temporary API failure")

    client = SimpleNamespace(models=SimpleNamespace(generate_content=fail))
    monkeypatch.setattr(summary_ai, "gemini_client", lambda api_key: client)
    monkeypatch.setattr(cli, "ARCHIVE_PATH", tmp_path / "archive.json")
    archive = Archive({"school/1": {"notice": {"source_id": "school", "title": "제목"},
                                    "body_text": "본문" * 30}})
    result = cli._fill_summaries(archive, {"model": "m"}, "key", {"school"}, {"school/1"})
    assert "summary_attempts" not in result.items["school/1"]
    assert result.items["school/1"]["summary_last_failed_at"]
    monkeypatch.setattr(cli, "summarize", lambda *args: {"school/1": "요약해요"})
    recovered = cli._fill_summaries(result, {"model": "m"}, "key", {"school"}, {"school/1"})
    assert recovered.items["school/1"]["summary"] == "요약해요"
    assert recovered.items["school/1"]["summary_last_failed_at"] is None


def test_invalid_json_and_wrong_shape_count_as_bad_reply():
    items = [{"id": "school/1", "title": "제목", "body": "본문"}]
    for reply in ("not json", "{}", '{"items": null}'):
        client = SimpleNamespace(models=SimpleNamespace(
            generate_content=lambda reply=reply, **kwargs: SimpleNamespace(text=reply)))
        assert summary_ai.summarize(items, "m", "k", client) == {}


def test_summary_prioritizes_newest_and_retries_legacy_failures(monkeypatch, tmp_path):
    monkeypatch.setattr(cli, 'ARCHIVE_PATH', tmp_path / 'archive.json')
    entries = {}
    for i in range(7):
        entries[f'school/{i}'] = {
            'notice': {'source_id': 'school', 'title': str(i), 'posted_on': f'2026-11-0{i + 1}'},
            'body_text': '본문' * 30,
        }
    entries['school/6']['summary_attempts'] = 2
    called = []
    monkeypatch.setattr(cli, 'summarize', lambda items, model, key: called.extend(items) or {})
    cli._fill_summaries(Archive(entries), {'model': 'm'}, 'key', {'school'}, set(entries))
    assert [x['id'] for x in called] == [f'school/{i}' for i in range(6, 0, -1)]


def test_retry_cooldown_avoids_repeated_failed_requests():
    from datetime import timedelta

    now = datetime(2026, 11, 5, tzinfo=cli.KST)
    assert cli._retry_due(3, None, now, 3)
    assert not cli._retry_due(3, now.isoformat(), now + timedelta(hours=23), 3)
    assert cli._retry_due(3, now.isoformat(), now + timedelta(hours=24), 3)
    assert cli._retry_due(2, now.isoformat(), now, 3)
