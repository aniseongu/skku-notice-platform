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
