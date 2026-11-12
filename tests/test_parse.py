from datetime import date
from pathlib import Path

import pytest

from skku_notice.parse import ParseError, parse_list


@pytest.mark.parametrize(
    ("source_id", "url", "expected_count", "expected_pinned", "first_no"),
    [
        ("skku-notice01", "https://www.skku.edu/skku/campus/skk_comm/notice01.do", 15, 5, "141498"),
        ("cse-notice", "https://cse.skku.edu/cse/notice.do", 10, 0, "227923"),
    ],
)
def test_fixtures(source_id: str, url: str, expected_count: int, expected_pinned: int, first_no: str) -> None:
    path = Path("tests/fixtures") / f"{source_id.replace('-', '_')}_list_2026-11-02.html"
    notices = parse_list(path.read_text(encoding="utf-8"), source_id, url)
    assert len(notices) == expected_count
    assert sum(notice.pinned for notice in notices) == expected_pinned
    assert notices[0].article_no == first_no
    assert notices[0].posted_on == date(2026, 11, 2)
    assert notices[0].category
    assert notices[0].url == f"{url}?mode=view&articleNo={first_no}"


@pytest.mark.parametrize(
    "html",
    [
        "<html></html>",
        "<ul class='board-list-wrap'></ul>",
        "<ul class='board-list-wrap'><li><dl class='board-list-content-wrap'></dl></li></ul>",
    ],
)
def test_broken_markup_raises(html: str) -> None:
    with pytest.raises(ParseError):
        parse_list(html, "x", "https://example.com/notice.do")


@pytest.mark.parametrize(
    ("source_id", "url", "expected_count", "has_category"),
    [
        ("sw-notice", "https://sw.skku.edu/sw/notice.do", 10, True),
        # 미래차 부트캠프 사업단 게시판은 분류 칸이 없다.
        ("futurecar-notice", "https://swb.skku.edu/futurecar/notice.do", 7, False),
    ],
)
def test_added_boards_2026_11_03(source_id: str, url: str, expected_count: int, has_category: bool) -> None:
    path = Path("tests/fixtures") / f"{source_id.replace('-', '_')}_list_2026-11-03.html"
    notices = parse_list(path.read_text(encoding="utf-8"), source_id, url)
    assert len(notices) == expected_count
    assert all(notice.url.startswith(f"{url}?mode=view&articleNo=") for notice in notices)
    assert bool(notices[0].category) is has_category


def test_view_board_id_variant_uses_a_stable_canonical_url():
    html = Path("tests/fixtures/art_notice_list_2026-11-07.html").read_text(encoding="utf-8")
    notices = parse_list(html, "art-notice", "https://art.skku.edu/art/notice.do")
    assert [n.article_no for n in notices] == ["138879", "138885"]
    assert notices[0].title.startswith("[일반교직]")
    assert notices[0].category == "학사"
    assert notices[0].posted_on.isoformat() == "2026-11-06"
    assert notices[1].pinned is True
    # 요청마다 바뀌는 뒤 6글자는 AAAAAA로 고정하고 불필요한 쪽 번호 매개변수는 뺀다.
    assert notices[0].url == (
        "https://art.skku.edu/art/notice.do?mode=view&viewBoardId=138879"
        "&itemId=B675138A6F559F0BA958AAABCF9D485AAAAAAA"
    )


def test_view_board_id_row_without_a_valid_item_id_is_rejected():
    html = (
        '<ul class="board-list-wrap"><li><dl class="board-list-content-wrap">'
        '<dt class="board-list-content-title">'
        '<a href="?mode=view&amp;viewBoardId=1&amp;itemId=short">제목</a></dt>'
        '<dd class="board-list-content-info">'
        "<ul><li>No.1</li><li>x</li><li>2026-11-06</li></ul></dd></dl></li></ul>"
    )
    with pytest.raises(ParseError):
        parse_list(html, "art-notice", "https://art.skku.edu/art/notice.do")


def test_aiuniv_notice_board_2026_11_12() -> None:
    url = "https://aiuniv.skku.edu/aiuniv/notice.do"
    html = Path("tests/fixtures/aiuniv_notice_list_2026-11-12.html").read_text(encoding="utf-8")
    notices = parse_list(html, "aiuniv-notice", url)
    assert len(notices) == 10
    assert all(notice.url.startswith(f"{url}?mode=view&articleNo=") for notice in notices)
