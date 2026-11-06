import argparse
from datetime import date

from skku_notice import cli
from skku_notice.archive import add_notice, update_detail
from skku_notice.judge import Judgment
from skku_notice.model import Notice
from skku_notice.notification_policy import alert_priority, is_internship
from skku_notice.state import SourceState, State, load_state, save_state


def test_school_always_alerts_and_internship_requires_relevant_ai():
    assert alert_priority(external=False, title="대학원생", body="", match=None,
                          judgment=Judgment("not_relevant", "이유", "model"), interests=()) == "low"
    for verdict in (None, "maybe", "not_relevant"):
        judgment = Judgment(verdict, "이유", "m") if verdict else None
        assert alert_priority(external=True, title="개발자", body="개발 업무", match=None,
                              judgment=judgment, interests=("개발",)) is None
    assert alert_priority(external=True, title="제목에 직무 없음", body="모집 분야: 개발",
                          match=None, judgment=Judgment("relevant", "개발 직무", "m"),
                          interests=()) == "default"


def test_school_internship_with_ineligible_judgment_does_not_alert():
    assert alert_priority(external=False, title="졸업예정자 인턴 모집", body="", match=None,
                          judgment=Judgment("not_relevant", "지원 불가", "m"), interests=()) is None
    assert not is_internship("International conference")
    assert is_internship("Summer internship")
    for verdict in ("relevant", "maybe"):
        assert alert_priority(external=False, title="인턴 모집", body="", match=None,
                              judgment=Judgment(verdict, "이유", "m"), interests=()) is not None


def test_new_intern_waits_for_key_and_body_then_judges_and_alerts_once(tmp_path, monkeypatch):
    monkeypatch.setattr(cli, "load_dotenv", lambda **kwargs: None)
    monkeypatch.setattr(cli, "_profile", lambda: {})
    monkeypatch.setattr(cli, "has_notification_channel", lambda: True)
    monkeypatch.setattr(cli, "STATE_PATH", tmp_path / "seen.json")
    monkeypatch.setattr(cli, "ARCHIVE_PATH", tmp_path / "archive.json")
    monkeypatch.setattr(cli, "INTERESTS_PATH", tmp_path / "no-interests.yaml")
    sources = tmp_path / "sources.yaml"
    sources.write_text('''user_agent: test
request_gap_seconds: 1
timeout_seconds: 10
sources:
- {id: jobs, name: 인턴, url: 'https://linkareer.com/activity', external: true}
''')
    monkeypatch.setattr(cli, "SOURCES_PATH", sources)
    ai = tmp_path / "ai.yaml"
    ai.write_text("enabled: true\nmodel: test\nmax_per_run: 30\n")
    monkeypatch.setattr(cli, "AI_PATH", ai)
    rules = tmp_path / "rules.yaml"
    rules.write_text("rules: []\n")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    stamp = "2026-11-04T00:00:00+09:00"
    notice = Notice("jobs", "1", "[회사] 채용연계형 인턴 모집", "인턴", "https://linkareer.com/activity/1",
                    date(2026, 11, 4), False)
    save_state(cli.STATE_PATH, State({"jobs": SourceState(stamp, {})}))
    monkeypatch.setattr(cli, "fetch_list", lambda *_args: "fixture")
    monkeypatch.setattr(cli, "parse_list", lambda *_args: [notice])
    monkeypatch.setattr(cli, "_recheck_details", lambda archive, *_args: archive)
    monkeypatch.setattr(cli, "_notify_changes", lambda archive, *_args: archive)
    quota = {"left": 1}

    def optional_translation(archive, _settings, key):
        if key:
            quota["left"] = max(0, quota["left"] - 1)
        return archive

    monkeypatch.setattr(cli, "_translate", optional_translation)
    monkeypatch.setattr(cli, "_ai_deadlines", lambda archive, *_args: archive)
    monkeypatch.setattr(cli, "_fill_summaries", lambda archive, *_args: archive)
    loaded = {"value": False}

    def fill(archive, _state, _boards, _settings, _fixtures, now):
        if "jobs/1" not in archive.items:
            archive = add_notice(archive, notice, now.isoformat())
        if loaded["value"]:
            return update_detail(archive, "jobs/1", "담당 업무: 백엔드 개발", (), now.isoformat())
        return archive

    monkeypatch.setattr(cli, "_fill_details", fill)
    calls = []

    def judge(items, *_args, **_kwargs):
        if not quota["left"]:
            return {}
        quota["left"] -= 1
        calls.append(items)
        return {"jobs/1": Judgment("relevant", "백엔드 개발 인턴이에요", "test")}

    monkeypatch.setattr(cli, "judge_internships", judge)
    monkeypatch.setattr(cli, "judge_notices",
                        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError()))
    sent = []
    monkeypatch.setattr(cli, "send_notice", lambda notice, *args: sent.append(notice.article_no) or True)
    args = argparse.Namespace(rules=rules, dry_run=False, all=False, from_fixtures=False,
                              no_ai=False, no_canvas=True, export=None)
    for _ in range(4):
        assert cli.run(args) == 0
        seen = load_state(cli.STATE_PATH).sources["jobs"].seen["1"]
        assert seen.status == "pending" and seen.attempts == 0
    assert not sent and not calls
    monkeypatch.setenv("GEMINI_API_KEY", "fake")
    assert cli.run(args) == 0 and not sent and not calls
    loaded["value"] = True
    quota["left"] = 1
    assert cli.run(args) == 0
    assert sent == ["1"] and calls[0][0]["body"] == "담당 업무: 백엔드 개발"
    assert load_state(cli.STATE_PATH).sources["jobs"].seen["1"].status == "notified"
    assert cli.run(args) == 0 and sent == ["1"] and len(calls) == 1


def test_school_judgment_retries_after_delivery_without_duplicate_alert(tmp_path, monkeypatch):
    from skku_notice.archive import load_archive

    monkeypatch.setattr(cli, "load_dotenv", lambda **kwargs: None)
    monkeypatch.setattr(cli, "_profile", lambda: {"year": 2})
    monkeypatch.setattr(cli, "has_notification_channel", lambda: True)
    monkeypatch.setattr(cli, "STATE_PATH", tmp_path / "seen.json")
    monkeypatch.setattr(cli, "ARCHIVE_PATH", tmp_path / "archive.json")
    monkeypatch.setattr(cli, "INTERESTS_PATH", tmp_path / "interests.yaml")
    sources = tmp_path / "sources.yaml"
    sources.write_text("user_agent: test\nrequest_gap_seconds: 1\ntimeout_seconds: 10\nsources:\n"
                       "- {id: school, name: 학교, url: 'https://example.com'}\n")
    monkeypatch.setattr(cli, "SOURCES_PATH", sources)
    ai = tmp_path / "ai.yaml"
    ai.write_text("enabled: true\nmodel: test\nmax_per_run: 30\n")
    monkeypatch.setattr(cli, "AI_PATH", ai)
    rules = tmp_path / "rules.yaml"
    rules.write_text("rules: []\n")
    monkeypatch.setenv("GEMINI_API_KEY", "fixture-key")
    notice = Notice("school", "1", "새 공지", None, "https://example.com/1", date(2026, 11, 4), False)
    save_state(cli.STATE_PATH, State({"school": SourceState("2026-11-04T00:00:00+09:00", {})}))
    monkeypatch.setattr(cli, "fetch_list", lambda *_args: "fixture")
    monkeypatch.setattr(cli, "parse_list", lambda *_args: [notice])
    monkeypatch.setattr(cli, "_fill_details", lambda archive, *_args: archive)
    monkeypatch.setattr(cli, "_recheck_details", lambda archive, *_args: archive)
    monkeypatch.setattr(cli, "_notify_changes", lambda archive, *_args: archive)
    monkeypatch.setattr(cli, "_images_for_judgment", lambda archive, *_args: (archive, {}))
    monkeypatch.setattr(cli, "_translate", lambda archive, *_args: archive)
    monkeypatch.setattr(cli, "_ai_deadlines", lambda archive, *_args: archive)
    monkeypatch.setattr(cli, "_fill_summaries", lambda archive, *_args: archive)
    calls = []
    def judge(notices, *_args, **_kwargs):
        calls.append(notices)
        return {} if len(calls) == 1 else {"school/1": Judgment("relevant", "확인해요", "test")}
    monkeypatch.setattr(cli, "judge_notices", judge)
    sent = []
    monkeypatch.setattr(cli, "send_notice", lambda notice, *_args: sent.append(notice.article_no) or True)
    args = argparse.Namespace(rules=rules, dry_run=False, all=False, from_fixtures=False,
                              no_ai=False, no_canvas=True, export=None)
    assert cli.run(args) == 0
    assert sent == ["1"]
    assert cli.run(args) == 0
    assert len(calls) == 2 and sent == ["1"]
    assert load_archive(cli.ARCHIVE_PATH).items["school/1"]["match"]["ai"]["verdict"] == "relevant"
    assert cli.run(args) == 0 and len(calls) == 2 and sent == ["1"]
