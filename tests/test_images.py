import argparse
import json
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import httpx
import pytest
import rapidocr

from skku_notice import cli, fetch, ocr
from skku_notice.archive import Archive, add_notice, load_archive, save_archive
from skku_notice.export import export_site
from skku_notice.fetch import ImageData
from skku_notice.judge import Judgment, judge_notices
from skku_notice.model import Notice


def notice(number: int) -> Notice:
    return Notice("cse-notice", str(number), "채용", None, "https://example.com", date(2026, 11, 2), False)


@pytest.mark.parametrize("length,expected", [(0, True), (49, True), (50, False)])
def test_image_eligibility_and_one_attempt(tmp_path: Path, monkeypatch, length, expected) -> None:
    now = datetime(2026, 11, 2, tzinfo=ZoneInfo("Asia/Seoul"))
    article = notice(1)
    archive = add_notice(Archive(), article, now.isoformat())
    archive.items["cse-notice/1"].update(body_text="가" * length, images=["https://example.com/1"],
                                         fetched_at=now.isoformat())
    monkeypatch.setattr(cli, "ARCHIVE_PATH", tmp_path / "archive.json")
    calls = []
    monkeypatch.setattr(cli, "fetch_images", lambda urls, agent, limit: calls.append(urls) or [])
    archive, _ = cli._images_for_judgment(archive, [article], now, "agent")
    assert bool(calls) is expected
    cli._images_for_judgment(archive, [article], now, "agent")
    assert len(calls) == int(expected)


def test_image_request_limits(tmp_path: Path, monkeypatch) -> None:
    now = datetime(2026, 11, 2, tzinfo=ZoneInfo("Asia/Seoul"))
    articles = [notice(number) for number in range(5)]
    archive = Archive()
    for article in articles:
        archive = add_notice(archive, article, now.isoformat())
        archive.items[f"cse-notice/{article.article_no}"].update(
            body_text="", images=[f"https://example.com/{n}" for n in range(5)],
            fetched_at=now.isoformat(),
        )
    monkeypatch.setattr(cli, "ARCHIVE_PATH", tmp_path / "archive.json")
    calls = []
    monkeypatch.setattr(cli, "fetch_images", lambda urls, agent, limit: calls.append(urls) or [])
    archive, _ = cli._images_for_judgment(archive, articles, now, "agent")
    assert [len(urls) for urls in calls] == [3, 3, 3, 1]
    assert archive.items["cse-notice/4"]["image_attempted"] is False


@pytest.mark.parametrize("content_type,chunks,accepted", [
    ("text/html", [b"small"], False),
    ("image/png", [b"x" * (5 * 1024 * 1024), b"x"], False),
    ("image/jpeg; charset=binary", [b"ok"], True),
])
def test_fetch_image_type_and_stream_limit(monkeypatch, content_type, chunks, accepted) -> None:
    monkeypatch.setattr(fetch, "_source_hosts", lambda: {"example.com"})
    monkeypatch.setattr(fetch, "_resolve_addresses", lambda host: {"8.8.8.8"})
    def respond(request):
        assert request.headers["User-Agent"] == "test-agent"
        return httpx.Response(200, headers={"Content-Type": content_type},
                              stream=httpx.ByteStream(b"".join(chunks)))

    original_client = httpx.Client
    monkeypatch.setattr(fetch.httpx, "Client", lambda **kwargs: original_client(
        transport=httpx.MockTransport(respond), **kwargs
    ))
    image = fetch.fetch_image("https://example.com/image", "test-agent")
    assert (image is not None) is accepted
    if accepted:
        assert image.mime_type == "image/jpeg"


def test_ocr_is_private_and_gemini_text_is_exported(tmp_path: Path, monkeypatch) -> None:
    article = notice(1)
    image = ImageData(b"image bytes", "image/png")

    class Models:
        def generate_content(self, *, model, contents, config):
            assert len(contents) == 3
            assert "cse-notice/1" in contents[1].text
            assert contents[2].inline_data.mime_type == "image/png"
            assert contents[2].inline_data.data == image.data
            return SimpleNamespace(text=json.dumps({"items": [{
                "id": "cse-notice/1", "verdict": "relevant", "reason": "지원 가능해요",
                "summary": "지원해요", "interests": [], "image_text": "그림 속 채용 안내",
            }]}))

    result = judge_notices([article], {"cse-notice": "학과"}, {"year": 4}, "test", "unused",
                           SimpleNamespace(models=Models()), images={"cse-notice/1": [image]})
    archive = add_notice(Archive(), article, "2026-11-02T00:00:00+09:00")
    archive.items["cse-notice/1"]["images"] = ["https://cse.skku.edu/image.png"]
    monkeypatch.setattr(cli, "read_images", lambda images: "OCR 채용 안내")
    archive = cli._apply_ocr(archive, {"cse-notice/1": [image]})
    archive = add_notice(archive, article, "2026-11-02T00:00:00+09:00", judgment=result["cse-notice/1"])
    export_site(tmp_path, archive, [], datetime.now(ZoneInfo("Asia/Seoul")), web_path=Path("missing"))
    detail = json.loads((tmp_path / "api/v1/notices/cse-notice/1.json").read_text())
    assert detail["body"] == "그림 속 채용 안내"
    assert detail["body_from_image"] is True
    assert detail["ocr_engine"] == "rapidocr"
    assert "ocr_text" not in detail
    assert archive.items["cse-notice/1"]["ocr_text"] == "OCR 채용 안내"


def test_ocr_without_gemini_does_not_set_body(tmp_path: Path, monkeypatch) -> None:
    article = notice(1)
    archive = add_notice(Archive(), article, "2026-11-02T00:00:00+09:00")
    monkeypatch.setattr(cli, "read_images", lambda images: "깨진 OCR")
    archive = cli._apply_ocr(archive, {"cse-notice/1": [ImageData(b"image", "image/png")]})
    export_site(tmp_path, archive, [], datetime.now(ZoneInfo("Asia/Seoul")), web_path=tmp_path / "missing")
    detail = json.loads((tmp_path / "api/v1/notices/cse-notice/1.json").read_text())
    assert detail["body"] is None
    assert detail["body_from_image"] is False
    assert "ocr_text" not in detail


def test_old_ocr_body_is_migrated_on_load(tmp_path: Path) -> None:
    archive = add_notice(Archive(), notice(1), "2026-11-02T00:00:00+09:00")
    archive.items["cse-notice/1"].update(body_text="깨진 OCR", body_from_image=True,
                                          ocr_engine="rapidocr")
    archive.items["cse-notice/1"].pop("ocr_text")
    path = tmp_path / "archive.json"
    save_archive(path, archive)
    item = load_archive(path).items["cse-notice/1"]
    assert item["ocr_text"] == "깨진 OCR"
    assert item["body_text"] == ""
    assert item["body_from_image"] is False


def test_saved_notice_image_ocr_without_network() -> None:
    models = Path(rapidocr.__file__).parent / "models"
    required = (
        "ch_PP-OCRv5_det_mobile.onnx",
        "ch_ppocr_mobile_v2.0_cls_mobile.onnx",
        "korean_PP-OCRv5_rec_mobile.onnx",
    )
    if any(not (models / name).exists() for name in required):
        pytest.skip("RapidOCR first-run models are not cached; tests must not download them")
    text = ocr.read_images([Path("tests/fixtures/images/cse_notice_227923.png").read_bytes()])
    assert "현대" in text or "채용" in text


def test_ocr_failure_returns_empty_with_one_warning(monkeypatch, caplog) -> None:
    def fail():
        raise RuntimeError("model unavailable")

    monkeypatch.setattr(ocr, "_engine", fail)
    assert ocr.read_images([b"invalid"]) == ""
    assert len(caplog.records) == 1


def test_ocr_keeps_text_when_later_image_fails(monkeypatch, caplog) -> None:
    def engine(image):
        if image == b"bad":
            raise ValueError("invalid image")
        return SimpleNamespace(txts=("채용",))

    monkeypatch.setattr(ocr, "_engine", lambda: engine)
    assert ocr.read_images([b"good", b"bad"]) == "채용"
    assert len(caplog.records) == 1


def test_ocr_runs_without_gemini_key(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(cli, "load_dotenv", lambda **kwargs: None)
    monkeypatch.setenv("NOTIFY_URLS", "ntfys://placeholder-topic")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("INTEREST_KEYWORDS", "현대 채용")
    monkeypatch.setattr(cli, "INTERESTS_PATH", tmp_path / "missing-interests.yaml")
    monkeypatch.setattr(cli, "STATE_PATH", tmp_path / "seen.json")
    monkeypatch.setattr(cli, "ARCHIVE_PATH", tmp_path / "archive.json")
    monkeypatch.setattr(cli, "_fixture", lambda source: "fixture")
    monkeypatch.setattr(cli, "fetch_list", lambda *args: "fixture")
    monkeypatch.setattr(cli, "fetch_detail", lambda *args: "detail")
    monkeypatch.setattr(cli, "parse_detail", lambda *args: SimpleNamespace(
        body_text="", body_html="<img src=\"https://example.com/image.png\">",
        attachments=(), images=("https://example.com/image.png",)
    ))
    monkeypatch.setattr(cli.time, "sleep", lambda seconds: None)
    current = [notice(1)]
    monkeypatch.setattr(cli, "parse_list", lambda html, source, url: [
        Notice(source, item.article_no, item.title, item.category, item.url, item.posted_on, False)
        for item in current
    ])
    monkeypatch.setattr(cli, "fetch_images", lambda urls, agent, limit: [ImageData(b"image", "image/png")])
    monkeypatch.setattr(cli, "read_images", lambda images: "현대 채용")
    sent = []
    monkeypatch.setattr(cli, "send_notice", lambda *args: sent.append(args[2]) or True)
    args = argparse.Namespace(rules=Path("config/rules.example.yaml"), dry_run=False, all=False,
                              from_fixtures=True, no_ai=False, no_canvas=True, export=None)
    assert cli.run(args) == 0
    current.append(notice(2))
    args.from_fixtures = False
    assert cli.run(args) == 0
    archive = json.loads((tmp_path / "archive.json").read_text())
    assert archive["items"]["cse-notice/2"]["body_text"] == ""
    assert archive["items"]["cse-notice/2"]["ocr_text"] == "현대 채용"
    assert archive["items"]["cse-notice/2"]["body_from_image"] is False
    assert sent == ["high"] * 2

    monkeypatch.setenv("GEMINI_API_KEY", "placeholder")
    monkeypatch.setattr(cli, "_profile", lambda: {"year": 4})
    bodies_seen = []

    def fake_judge(*args, **kwargs):
        bodies_seen.append(kwargs["bodies"])
        return {"cse-notice/3": Judgment("relevant", "지원 가능", "test", (),
                                          "지원해요", "Gemini가 읽은 채용 안내")}

    monkeypatch.setattr(cli, "judge_notices", fake_judge)
    current.append(notice(3))
    args.export = tmp_path / "site"
    assert cli.run(args) == 0
    assert "현대 채용" in bodies_seen[0]["cse-notice/3"]
    detail = json.loads((tmp_path / "site/api/v1/notices/cse-notice/3.json").read_text())
    assert detail["body"] == "Gemini가 읽은 채용 안내"
    assert detail["body_from_image"] is True
    assert "ocr_text" not in detail
