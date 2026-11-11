from datetime import date
from pathlib import Path

import pytest

from skku_notice.model import Notice
from skku_notice.parse import ParseError, parse_detail


def test_encoded_froala_html_in_pre_is_parsed_as_notice_body():
    html = ('<dl class="board-write-box"><dd><pre class="pre">'
            '&lt;div class="fr-view"&gt;&lt;p&gt;1.&amp;nbsp;채용분야&lt;/p&gt;'
            '&lt;p&gt;이메일 접수&lt;/p&gt;&lt;script&gt;bad()&lt;/script&gt;&lt;/div&gt;'
            '</pre></dd></dl>')
    detail = parse_detail(html, 'https://www.skku.edu/notice')
    assert '1. 채용분야' in detail.body_text
    assert '이메일 접수' in detail.body_text
    assert '<div' not in detail.body_text and 'bad()' not in detail.body_text
    assert '<p>이메일 접수</p>' in detail.body_html
    assert '<script' not in detail.body_html and 'bad()' not in detail.body_html


def test_plain_pre_preserves_literal_markup():
    html = '<dl class="board-write-box"><dd><pre>예시: &lt;div&gt;내용&lt;/div&gt;</pre></dd></dl>'
    detail = parse_detail(html, 'https://www.skku.edu/notice')
    assert '<div>내용</div>' in detail.body_text
    assert '&lt;div&gt;' in detail.body_html

FIXTURES = Path(__file__).parent / "fixtures"


def make_notice(number: int) -> Notice:
    return Notice("cse-notice", str(number), "모집", None,
                  f"https://cse.skku.edu/cse/notice.do?mode=view&articleNo={number}",
                  date(2026, 11, 2), False)


def test_detail_fixtures() -> None:
    skku = (FIXTURES / "skku_notice01_view_141498_2026-11-02.html").read_text()
    detail = parse_detail(skku, "https://www.skku.edu/skku/campus/skk_comm/notice01.do")
    assert "성균관대 창업지원단" in detail.body_text
    assert len(detail.attachments) == 2
    assert detail.images == ("https://www.skku.edu/_attach/image/2026/11/kZLqHbhAfbssKRHGyaXE.png",)
    assert detail.attachments[0][1].startswith("https://www.skku.edu/")
    assert detail.attachments[0][2:] == ("DOCX", None)
    assert detail.attachments[1][2:] == ("HWP", None)
    assert 'href="https://forms.gle/e6TodAVp4vqhJpGg8"' in detail.body_html
    assert "<ul>" in detail.body_html and "<li>" in detail.body_html
    assert "\n\n\n" not in detail.body_text
    cse = (FIXTURES / "cse_notice_view_227923_2026-11-02.html").read_text()
    cse_detail = parse_detail(cse, "https://cse.skku.edu/cse/notice.do")
    assert cse_detail.body_text == ""
    assert cse_detail.images == (
        "https://cse.skku.edu/_res/editor_image/2026/11/pUZGIAUXiakYxQErSSXq0.png",)
    with pytest.raises(ParseError):
        parse_detail("<html>missing</html>", "https://example.com")
    assert parse_detail("<dl class='board-write-box'><dd><p>A<script>bad</script> B</p><p>C</p></dd></dl>",
                        "https://example.com").body_text == "A B\nC"


def test_detail_images_are_filtered_deduplicated_and_limited() -> None:
    html = "<dl class='board-write-box'><dd>" + "".join(
        f"<img src='/uploads/{number}.png'>" for number in range(12)
    ) + "<img src='/uploads/0.png'><img src='/_res/cse/img/common/sns_insta.png'>" \
        "<img src='/uploads/ico_share.png'><img src='javascript:bad'></dd></dl>"
    images = parse_detail(html, "https://cse.skku.edu/cse/notice.do").images
    assert len(images) == 10
    assert images == tuple(f"https://cse.skku.edu/uploads/{number}.png" for number in range(10))


def test_detail_html_sanitization_and_attachment_type() -> None:
    html = ("<dl class='board-write-box'><dd><p style='color:red' id='x' onclick='bad()'>안내"
            "<script>alert(1)</script><a href='javascript:bad()'>위험</a>"
            "<a href='/apply' class='x'>신청</a></p><p> </p>"
            "<table><tr><td colspan='2' onmouseover='bad()'>표</td></tr></table>"
            "<img src='/_res/cse/img/common/icon.png'><img src='/poster.png'></dd></dl>"
            "<ul class='filedown_list'><li><a href='?mode=download&attachNo=1'>양식.HwPx</a> 123KB</li></ul>")
    detail = parse_detail(html, "https://cse.skku.edu/cse/notice.do")
    assert "alert" not in detail.body_html
    assert "javascript:" not in detail.body_html
    assert all(word not in detail.body_html for word in ("style=", "class=", "id=", "onclick", "onmouseover"))
    assert '<a href="https://cse.skku.edu/apply">신청</a>' in detail.body_html
    assert '<table><tbody><tr><td colspan="2">표</td></tr></tbody></table>' in detail.body_html
    assert "<p> </p>" not in detail.body_html
    assert "icon.png" not in detail.body_html
    assert detail.attachments[0][2:] == ("HWPX", "123KB")














