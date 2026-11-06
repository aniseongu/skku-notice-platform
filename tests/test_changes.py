from datetime import date

from skku_notice import cli
from skku_notice.archive import Archive, add_notice, note_body_change, note_list_changes
from skku_notice.export import _public_notice
from skku_notice.model import Notice


def notice(title: str) -> Notice:
    return Notice("cse-notice", "1", title, "채용", "https://cse.skku.edu/cse/notice.do?mode=view&articleNo=1",
                  date(2026, 11, 2), False)


def test_add_notice_keeps_translation_and_ai_deadline():
    archive = add_notice(Archive(), notice("Seminar"), "2026-11-02T00:00:00+09:00")
    key = "cse-notice/1"
    archive = Archive({key: {**archive.items[key], "translation": {"title": "세미나"},
                             "ai_deadline": {"checked": True}}})
    again = add_notice(archive, notice("Seminar"), "2026-11-02T00:00:00+09:00")
    assert again.items[key]["translation"] == {"title": "세미나"}
    assert again.items[key]["ai_deadline"] == {"checked": True}


def test_title_change_is_recorded_and_redoes_derived_fields():
    archive = add_notice(Archive(), notice("인턴 모집 (~11/10)"), "2026-11-02T00:00:00+09:00")
    key = "cse-notice/1"
    extra = {"translation": {"title": "x"}, "ai_deadline": {"checked": True}}
    archive = Archive({key: {**archive.items[key], **extra}})
    edited = [notice("인턴 모집 (마감 연장 ~11/20)")]
    changed, keys = note_list_changes(archive, edited, "2026-11-03T09:00:00+09:00")
    item = changed.items[key]
    assert keys == [key]
    assert item["previous_title"] == "인턴 모집 (~11/10)" and item["change_kind"] == "제목"
    assert "translation" not in item and "ai_deadline" not in item
    assert item["notice"]["deadline"].startswith("2026-11-20")
    assert note_list_changes(changed, [notice("인턴 모집 (마감 연장 ~11/20)")], "x")[1] == []


def test_body_change_only_when_text_differs():
    archive = Archive({"a/1": {"notice": {"id": "a/1"}, "body_text": "본문"}})
    same, changed = note_body_change(archive, "a/1", " 본문 ", "t1")
    assert not changed and same.items["a/1"]["rechecked_at"] == "t1" and "changed_at" not in same.items["a/1"]
    new, changed = note_body_change(archive, "a/1", "고친 본문", "t2")
    assert changed and new.items["a/1"]["changed_at"] == "t2" and new.items["a/1"]["change_kind"] == "본문"


def test_changed_important_notice_is_announced_once(monkeypatch, tmp_path):
    monkeypatch.setattr(cli, "ARCHIVE_PATH", tmp_path / "archive.json")
    monkeypatch.delenv("SAVED_NOTICES", raising=False)
    sent = []
    monkeypatch.setattr(cli, "send_notice", lambda n, *args: sent.append(n.title) or True)
    base = add_notice(Archive(), notice("인턴 모집"), "2026-11-02T00:00:00+09:00")
    key = "cse-notice/1"
    item = {**base.items[key], "changed_at": "t", "change_kind": "제목"}
    mine = Archive({key: {**item, "match": {**item["match"], "rule_name": "인턴"}}})
    other = Archive({key: item})
    after = cli._notify_changes(mine, {"cse-notice": "소프트웨어학과"})
    assert sent == ["[수정] 인턴 모집"]
    cli._notify_changes(after, {})
    cli._notify_changes(other, {})
    assert sent == ["[수정] 인턴 모집"]
    assert _public_notice(after.items[key]).get("changed_at") == "t"


def test_external_title_change_does_not_send_school_change_alert(monkeypatch):
    monkeypatch.delenv('SAVED_NOTICES', raising=False)
    sent = []
    monkeypatch.setattr(cli, 'send_notice', lambda *args: sent.append(args) or True)
    base = add_notice(Archive(), notice('인턴 모집'), '2026-11-02T00:00:00+09:00')
    item = base.items['cse-notice/1']
    archive = Archive({'cse-notice/1': {**item, 'changed_at': 't',
                       'match': {**item['match'], 'rule_name': '인턴'}}})
    cli._notify_changes(archive, {}, frozenset({'cse-notice'}))
    assert not sent
