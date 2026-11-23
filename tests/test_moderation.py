import json
from unittest.mock import Mock
from uuid import UUID

import pytest

from scripts import moderation

POST = "12345678-abcd-4321-abcd-123456789abc"
AUTHOR = "abcdef12-abcd-4321-abcd-123456789abc"
SERIES = "99999999-abcd-4321-abcd-123456789abc"


@pytest.mark.parametrize("command", ["reports", "series-candidates"])
def test_parse_read_commands(command):
    assert moderation.parse_args([command]).command == command


@pytest.mark.parametrize("argv", [
    [], ["hide", "unknown", POST], ["unhide", "question", "bad"], ["bind", "school/1", SERIES, "--y"],
])
def test_parse_rejects_invalid_arguments(argv):
    with pytest.raises(SystemExit) as exc:
        moderation.parse_args(argv)
    assert exc.value.code == 2


@pytest.mark.parametrize(("argv", "rpc", "payload"), [
    (["hide", "answer", POST.upper()], "moderation_set_hidden",
     {"p_kind": "answer", "p_post_id": POST, "p_hidden": True}),
    (["unhide", "team", POST], "moderation_set_hidden",
     {"p_kind": "team", "p_post_id": POST, "p_hidden": False}),
    (["bind", "school/1", SERIES], "qe_bind_series",
     {"p_notice_id": "school/1", "p_series_id": SERIES}),
])
def test_writes_require_yes(argv, rpc, payload, monkeypatch, capsys):
    connect = Mock()
    monkeypatch.setattr(moderation, "ModerationStore", connect)
    assert moderation.main(argv) == 0
    connect.assert_not_called()
    preview = capsys.readouterr().out.splitlines()
    assert "--yes" in preview[0]
    assert json.loads(preview[1]) == {"command": argv[0], **payload}

    assert moderation.main([*argv, "--yes"]) == 0
    connect.return_value.rpc.assert_called_once_with(rpc, payload)
    connect.return_value.close.assert_called_once()


def test_reports_mask_author_count_by_post_and_truncate_body(monkeypatch, capsys):
    question = {
        "id": POST, "kind": "question", "parent_id": SERIES, "author": AUTHOR, "hidden_at": "now",
        "deleted_at": None, "body": "가" * 79 + "\u202e" + "truncated",
    }
    team = {"id": SERIES, "author": AUTHOR, "hidden_at": None, "deleted_at": None, "body": "팀 모집"}
    connect = Mock()
    connect.return_value.rows.side_effect = [[{"post": question}] * 2, [{"post": team}]]
    monkeypatch.setattr(moderation, "ModerationStore", connect)

    assert moderation.main(["reports"]) == 0
    output = capsys.readouterr().out
    assert AUTHOR not in output and "\u202e" not in output and "truncated" not in output
    assert json.loads(output) == [
        {"kind": "answer", "id": POST, "reports": 2, "hidden": True, "deleted": False,
         "author": moderation.author_hash(AUTHOR), "body": question["body"][:80]},
        {"kind": "team", "id": SERIES, "reports": 1, "hidden": False, "deleted": False,
         "author": moderation.author_hash(AUTHOR), "body": team["body"]},
    ]
    assert len(moderation.author_hash(AUTHOR)) == 8
    assert moderation.author_hash(AUTHOR) != UUID(AUTHOR).hex[:8]
    assert moderation.author_hash(AUTHOR) == moderation.author_hash(AUTHOR.upper())
    connect.return_value.rpc.assert_not_called()


def test_series_candidates_match_linked_and_snapshot_titles_for_unbound_notices():
    store = Mock()
    store.rows.side_effect = [
        [{"id": SERIES, "organization_key": "example", "program_key": "data-intern"}],
        [{"id": "school/1", "title": "2025년 데이터-실습 1기"},
         {"id": "school/2", "title": "２０２６년도 [데이터 실습] 제2기"},
         {"id": "school/3", "title": "2026년 새싹 프로그래밍 2기"},
         {"id": "school/4", "title": "오케스트라 합주"}],
        [{"notice_id": "school/1", "series_id": SERIES},
         {"notice_id": "school/2", "series_id": POST}],
        [{"series_id": SERIES, "notice_title_snapshot": "새싹-프로그래밍 1기"}],
    ]
    results = moderation.series_candidates(store)
    assert [row["notice_id"] for row in results] == ["school/2", "school/3"]
    assert all(row["candidates"][0]["id"] == SERIES for row in results)
    assert all(row["candidates"][0]["similarity"] == 1.0 for row in results)
    store.rpc.assert_not_called()


def test_similarity_ranks_and_limits_matches():
    aliases = {
        "fourth-exact": {"데이터분석인턴"},
        "second-exact": {"데이터분석인턴"},
        "first-close": {"데이터분석인턴십"},
        "third-exact": {"데이터분석인턴"},
        "remote": {"오케스트라합주"},
    }
    assert moderation.matching_series("2026 데이터 분석 인턴", aliases) == [
        ("fourth-exact", 1), ("second-exact", 1), ("third-exact", 1),
    ]
    assert moderation.matching_series("2026년 제2기", aliases) == []


def test_rows_page_past_server_cap():
    store = object.__new__(moderation.ModerationStore)
    store._request = Mock()
    store._request.side_effect = [Mock(**{"json.return_value": page}) for page in (
        [{"id": "1"}], [{"id": "2"}], [],
    )]
    assert list(store.rows("qe_posts", "id", "id")) == [{"id": "1"}, {"id": "2"}]
    assert [call.kwargs["params"]["offset"] for call in store._request.call_args_list] == [0, 1, 2]


def test_connection_failure_does_not_print_credentials(monkeypatch, capsys):
    secret = "sb_secret_test_only"
    monkeypatch.setenv("SUPABASE_SECRET_KEY", secret)
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    connect = Mock(side_effect=moderation.StoreError(f"request failed with {secret}"))
    monkeypatch.setattr(moderation, "ModerationStore", connect)
    assert moderation.main(["reports"]) == 1
    connect.assert_called_once_with("https://test.supabase.co", secret)
    captured = capsys.readouterr()
    assert secret not in captured.out + captured.err
