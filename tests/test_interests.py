import json
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from skku_notice.archive import Archive, add_notice
from skku_notice.export import export_site
from skku_notice.interests import load_interests, match_interests
from skku_notice.judge import judge_notices
from skku_notice.model import Notice
from skku_notice.notify import send_notice


def notice(title: str, category: str = "일반") -> Notice:
    return Notice("board", "1", title, category, "https://example.com/1", date(2026, 11, 2), False)


def test_load_interests_merges_environment_and_optional_yaml(tmp_path: Path) -> None:
    path = tmp_path / "interests.yaml"
    assert load_interests(path, "겨울방학 인턴, 장학\n공모전") == (
        "겨울방학 인턴", "장학", "공모전"
    )
    path.write_text("keywords: [장학, 체험형]", encoding="utf-8")
    assert load_interests(path, "겨울방학 인턴, 장학") == ("겨울방학 인턴", "장학", "체험형")


@pytest.mark.parametrize(
    ("keyword", "title", "category", "expected"),
    [
        ("겨울방학 인턴", "겨울 방학 인턴 모집", "일반", True),
        ("겨울방학 인턴", "겨울 방학 현장 실습", "일반", False),
        ("겨울방학 인턴", "겨울방학", "체험형", False),
        ("장학", "장학생 선발", "일반", True),
        ("장학금", "장학 안내", "일반", False),
        ("공모전", "2026 경진대회", "일반", False),
        ("WINTER Internship", "winter internship", "일반", True),
        ("겨울방학 인턴", "겨울방학 행사", "일반", False),
    ],
)
def test_match_interests(keyword, title, category, expected) -> None:
    assert bool(match_interests(notice(title, category), (keyword,))) is expected


def test_match_interests_uses_ocr_text() -> None:
    assert match_interests(notice("모집"), ("현대 채용",), "현대 채용") == ("현대 채용",)


def test_gemini_interests_are_restricted_to_supplied_list() -> None:
    class Models:
        def generate_content(self, *, model, contents, config):
            assert json.loads(contents)["interests"] == ["겨울방학 인턴"]
            schema = config.response_schema["properties"]["items"]["items"]
            assert schema["properties"]["interests"] == {"type": "ARRAY", "items": {"type": "STRING"}}
            assert "interests" in schema["required"]
            assert "판정어(해당, 확인 필요, 해당 없음)를 되풀이하지 마세요" in config.system_instruction
            return type("Response", (), {"text": json.dumps({"items": [{
                "id": "board/1", "verdict": "maybe", "reason": "관련 과정으로 보임",
                "interests": ["가짜", "겨울방학 인턴"],
            }]})})()

    client = type("Client", (), {"models": Models()})()
    result = judge_notices([notice("동계 체험형")], {"board": "게시판"}, {}, "test", "unused",
                           client, ("겨울방학 인턴",))
    assert result["board/1"].interests == ("겨울방학 인턴",)


def test_export_interests_without_ai(tmp_path: Path) -> None:
    now = datetime(2026, 11, 2, tzinfo=ZoneInfo("Asia/Seoul"))
    archive = add_notice(Archive(), notice("겨울방학 인턴"), now.isoformat(),
                         interests=("겨울방학 인턴",), priority="high")
    export_site(tmp_path / "site", archive, [], now, web_path=tmp_path / "absent")
    matched = json.loads((tmp_path / "site/api/v1/matched.json").read_text())
    assert matched["items"]["board/1"]["interests"] == ["겨울방학 인턴"]
    assert matched["items"]["board/1"]["ai"] is None


def test_notification_interest_is_first_line(monkeypatch) -> None:
    monkeypatch.setenv("NOTIFY_URLS", "ntfys://placeholder-topic")

    class Sender:
        def add(self, url):
            return True

        def notify(self, *, title, body):
            assert body.splitlines()[0] == "관심 겨울방학 인턴"
            return True

    monkeypatch.setattr("skku_notice.notify.apprise.Apprise", Sender)
    assert send_notice(notice("겨울방학 인턴"), "게시판", "high", None, "관련 공지",
                       ("겨울방학 인턴",))


def test_muted_categories_from_settings_variable():
    from skku_notice.interests import muted_from_env

    assert muted_from_env("행사/세미나\n 학사 ,\n") == frozenset({"행사/세미나", "학사"})
    assert muted_from_env("") == frozenset()


def test_archived_interests_are_recomputed_literally():
    from skku_notice.interests import refresh_archive_interests

    items = {
        "a/1": {"notice": {"title": "AI Campus 교육생 모집", "category": "채용/모집"},
                "match": {"rule_name": None, "interests": ["인턴"]}},
        "a/2": {"notice": {"title": "장학생 선발", "category": "장학"}, "body_text": "체험형 인턴 과정",
                "match": {"interests": []}},
    }
    refreshed = refresh_archive_interests(items, ("인턴", "장학"))
    assert refreshed["a/1"]["match"]["interests"] == []
    assert refreshed["a/2"]["match"]["interests"] == ["인턴", "장학"]
