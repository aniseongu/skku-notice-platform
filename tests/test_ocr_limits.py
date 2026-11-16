from io import BytesIO

import httpx
import pytest
from PIL import Image

from skku_notice import ocr
from skku_notice import ocr_collection as job


def image_bytes(size):
    image = Image.new("RGB", size, "white")
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def test_large_poster_is_scaled_before_tiling():
    tiles = list(ocr._image_tiles(image_bytes((1200, 12000))))
    assert len(tiles) > 1
    with Image.open(BytesIO(tiles[0])) as tile:
        assert 800 <= tile.width < 1200


def test_safety_ceiling_and_bad_format():
    with pytest.raises(ocr.PermanentImageError):
        list(ocr._image_tiles(image_bytes((9000, 9000))))
    with pytest.raises(ocr.PermanentImageError):
        ocr.validate_image(b"not an image")


def test_permanent_skip_is_not_requeued_and_keeps_ready_result():
    import json

    client = job.OCRStore("https://example.supabase.co", "sb_secret_test")
    requests = []
    client.client._transport = httpx.MockTransport(
        lambda request: requests.append(request) or httpx.Response(200, json=[])
    )
    try:
        client.skip_permanently("school/1", "https://www.skku.edu/a", was_ready=False)
        body = json.loads(requests[-1].content)
        assert body["status"] == "failed"
        assert body["last_attempt_at"] == job.PERMANENT_ATTEMPT.isoformat()
        client.skip_permanently("school/1", "https://www.skku.edu/a", was_ready=True)
        assert json.loads(requests[-1].content) == {"last_attempt_at": job.PERMANENT_ATTEMPT.isoformat()}
        client.candidate(job.datetime.now(job.UTC))
        assert "last_attempt_at.lt." in requests[-1].url.params["or"]
    finally:
        client.close()


@pytest.mark.parametrize(("result", "exit_code"), [("skipped", 0), ("failed", 1)])
def test_batch_exit_code(monkeypatch, capsys, result, exit_code):
    class Store:
        def __init__(self, *_args):
            pass

        def discover(self):
            pass

        def close(self):
            pass

    monkeypatch.setattr(job, "OCRStore", Store)
    results = iter([result, "idle"])
    monkeypatch.setattr(job, "run_one", lambda *_args, **_kwargs: next(results))
    monkeypatch.setattr(job.time, "sleep", lambda _: None)
    assert job.main() == exit_code
    assert "'skipped':" in capsys.readouterr().out


