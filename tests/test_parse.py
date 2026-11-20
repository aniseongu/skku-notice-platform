from datetime import date
from pathlib import Path

import pytest

from skku_notice.parse import ParseError, parse_detail, parse_list

BOOTCAMP = "https://aibootcamp-skku.co.kr/news"


def test_aibootcamp_list_keeps_pinned_notices_and_canonical_article_numbers():
    html = Path("tests/fixtures/aibootcamp_news_list_2026-11-21.html").read_text(encoding="utf-8")
    notices = parse_list(html, "aibootcamp-news", BOOTCAMP)
    pinned, regular = notices[0], notices[6]
    assert len(notices) == 15
    assert sum(notice.pinned for notice in notices) == 6
    assert (pinned.article_no, pinned.posted_on, pinned.url, pinned.pinned) == (
        "45", date(2026, 11, 20), f"{BOOTCAMP}/45", True,
    )
    assert pinned.title.startswith("반도체설계교육센터(IDEC) 수강생 모집")
    assert (regular.article_no, regular.posted_on, regular.pinned) == ("41", date(2026, 10, 12), False)
    second_page = html.replace("/news/45", "/news/45?page=2")
    assert parse_list(second_page, "aibootcamp-news", BOOTCAMP + "?page=2") == notices
    with pytest.raises(ParseError):
        parse_list(html.replace(".co.kr/news/45", ".co.kr.evil.com/news/45"), "aibootcamp-news", BOOTCAMP)


def test_aibootcamp_detail_reads_the_body_and_images_above_the_editor():
    html = Path("tests/fixtures/aibootcamp_news_detail_2026-11-21.html").read_text(encoding="utf-8")
    detail = parse_detail(html, f"{BOOTCAMP}/41")
    assert "이수 신청" in detail.body_text
    assert len(detail.images) == 1
    assert detail.images[0].startswith("https://aibootcamp-skku.co.kr/data/file/news/thumb-")
    assert "<p>" in detail.body_html
    assert "style=" not in detail.body_html


def test_aibootcamp_attachments_link_to_the_original_and_detail_filters_unsafe_urls():
    url = f"{BOOTCAMP}/31"
    detail = parse_detail("""
        <div id="bo_v_con"><p>안내</p>
          <a href="/news/45">공지</a><a href="/bbs/login.php">다른 경로</a>
          <a href="https://aibootcamp-skku.co.kr.evil.com/news/45">위장</a>
          <a href="https://forms.gle/example">신청</a>
          <img src="https://aibootcamp-skku.co.kr:443/data/file/news/bad.png">
          <img src="/data/editor/2611/post.png">
        </div>
        <section id="bo_v_file">
          <a href="/bbs/download.php?bo_table=news&amp;wr_id=31&amp;no=0&amp;nonce=sample">
            <strong>양식.hwp</strong> (58.0K)
          </a>
          <a href="/bbs/download.php?bo_table=news&amp;wr_id=30&amp;no=0&amp;nonce=sample">
            <strong>다른 글.hwp</strong>
          </a>
        </section>
    """, url)
    assert detail.attachments == (("양식.hwp", f"{url}#bo_v_file", "HWP", "58.0K"),)
    assert detail.images == ("https://aibootcamp-skku.co.kr/data/editor/2611/post.png",)
    assert f'href="{BOOTCAMP}/45"' in detail.body_html
    assert 'href="https://forms.gle/example"' in detail.body_html
    assert all(bad not in detail.body_html for bad in ("login.php", "evil.com", "bad.png"))


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
    assert [n.article_no for n in notices] == ["1422", "1421"]
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


def test_exchange_notice_table() -> None:
    url = "https://www.skku.edu/skku/international/globalComm/international01.do"
    html = Path("tests/fixtures/skku_exchange_notice_list.html").read_text(encoding="utf-8")
    notices = parse_list(html, "skku-exchange-notice", url)
    assert len(notices) == 2
    assert notices[0].title == "2027학년도 2학기 해외파견 교환학생 설명회 자료 게시"
    assert notices[0].url == f"{url}?mode=view&articleNo=141784"
    assert notices[0].posted_on == date(2026, 11, 11)
    assert notices[1].article_no == "141091"
    assert notices[1].posted_on == date(2026, 10, 29)


def test_cscience_notice_board_uses_per_post_number_not_shared_board_id() -> None:
    url = "https://cscience.skku.edu/cscience/notice.do"
    html = Path("tests/fixtures/cscience_notice_list_2026-11-18.html").read_text(encoding="utf-8")
    notices = parse_list(html, "cscience-notice", url)
    assert len(notices) == 10
    assert len({n.article_no for n in notices}) == 10
    assert notices[0].article_no == "822"
    assert notices[0].url.startswith(f"{url}?mode=view&viewBoardId=138879&itemId=CF697A47")


def test_aibootcamp_list_reads_gnuboard_short_dates():
    from skku_notice.parse import _gnuboard_date

    today = date(2026, 11, 21)
    assert _gnuboard_date("18:30", today) == today
    assert _gnuboard_date("26-11-20", today) == date(2026, 11, 20)
    assert _gnuboard_date("2026-11-20", today) == date(2026, 11, 20)
    with pytest.raises(ValueError):
        _gnuboard_date("어제", today)
    html = Path("tests/fixtures/aibootcamp_news_list_2026-11-21.html").read_text(encoding="utf-8")
    notices = parse_list(html.replace("2026-11-20</td>", "09:15</td>", 1), "aibootcamp-news", BOOTCAMP)
    assert len(notices) == 15
