from datetime import date
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
import rapidocr

from skku_notice import fetch, ocr
from skku_notice.model import Notice


def notice(number: int) -> Notice:
    return Notice("cse-notice", str(number), "채용", None, "https://example.com", date(2026, 11, 2), False)






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




def test_large_ocr_image_is_split_with_overlapping_bounded_tiles(monkeypatch):
    from io import BytesIO
    from types import SimpleNamespace

    from PIL import Image

    image = Image.new('RGB', (120, 3200), 'white')
    payload = BytesIO()
    image.save(payload, format='PNG')
    sizes = []

    def engine(data):
        with Image.open(BytesIO(data)) as tile:
            sizes.append(tile.size)
        return SimpleNamespace(txts=['공지'])

    monkeypatch.setattr(ocr, '_engine', lambda: engine)
    assert ocr.read_images([payload.getvalue()]) == '공지\n공지\n공지'
    assert sizes == [(120, 1480), (120, 1560), (120, 480)]


def test_ocr_rejects_extreme_dimensions_without_running_engine(monkeypatch):
    from io import BytesIO

    from PIL import Image

    image = Image.new('RGB', (4000, 3100), 'white')
    payload = BytesIO()
    image.save(payload, format='PNG')
    calls = []
    monkeypatch.setattr(ocr, '_engine', lambda: lambda data: calls.append(data))
    assert ocr.read_images([payload.getvalue()]) == ''
    assert not calls
