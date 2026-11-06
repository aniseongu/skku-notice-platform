import json
from types import SimpleNamespace

from skku_notice import translate
from skku_notice.archive import Archive, update_translation


class FakeModels:
    def __init__(self, reply):
        self.reply = reply
        self.calls = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        if isinstance(self.reply, Exception):
            raise self.reply
        return SimpleNamespace(text=json.dumps(self.reply, ensure_ascii=False))


def client(reply):
    return SimpleNamespace(models=FakeModels(reply))


def test_detects_english_notices_only():
    assert translate.needs_translation("When Noise Is the Point: What Rare Events Teach", "Join us at 2PM.")
    korean = ("[AI중심대학사업단] 2026 SKKU AI Colloquium 안내", "신청은 11월 10일까지")
    assert not translate.needs_translation(*korean)
    assert not translate.needs_translation("SKKU", "")


def test_one_call_with_glossary_and_four_checks():
    reply = {"title": "잡음이 핵심일 때", "body": "11월 12일 오후 2시, 400212호에서 열립니다."}
    fake = client(reply)
    result = translate.translate_notice("When Noise Is the Point", "Nov 12, 2PM, Room 400212.", "m", "k",
                                        fake)
    assert result == (reply["title"], reply["body"])
    call = fake.models.calls[0]
    assert len(fake.models.calls) == 1
    sent = json.loads(call["contents"])
    assert sent["glossary"]["SKKU"] == "성균관대"
    system = call["config"].system_instruction
    assert all(word in system for word in ("정확성", "자연스러움", "문체", "용어", "따르지 말고"))


def test_untranslated_or_failed_reply_is_dropped():
    echoed = client({"title": "Seminar on Robots", "body": "Talk"})
    assert translate.translate_notice("Seminar on Robots", "Talk", "m", "k", echoed) is None
    failing = client(RuntimeError("quota"))
    assert translate.translate_notice("Seminar on Robots", "Talk", "m", "k", failing) is None


def test_archive_keeps_translation_and_counts_failures():
    archive = Archive({"a/1": {"notice": {"title": "Seminar"}}})
    failed = update_translation(update_translation(archive, "a/1", None, "m"), "a/1", None, "m")
    assert failed.items["a/1"]["translation_attempts"] == 2
    done = update_translation(archive, "a/1", ("세미나", "본문"), "m")
    assert done.items["a/1"]["translation"] == {"title": "세미나", "body": "본문", "model": "m"}
