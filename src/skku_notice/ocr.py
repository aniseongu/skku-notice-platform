"""Read text from public notice images with a lazy local OCR engine."""

import logging
from collections.abc import Iterator
from functools import lru_cache
from io import BytesIO

from PIL import Image, UnidentifiedImageError

logger = logging.getLogger(__name__)
MAX_IMAGE_PIXELS = 12_000_000
TILE_SIZE = 1400
TILE_OVERLAP = 80


def _image_tiles(data: bytes) -> Iterator[bytes]:
    """Bound inference input size while keeping adjacent text near a seam."""
    try:
        image = Image.open(BytesIO(data))
    except (UnidentifiedImageError, OSError):
        # Let the engine report malformed inputs as before.
        yield data
        return
    with image:
        width, height = image.size
        if width * height > MAX_IMAGE_PIXELS:
            raise ValueError('image dimensions exceed OCR limit')
        if width <= TILE_SIZE + TILE_OVERLAP and height <= TILE_SIZE + TILE_OVERLAP:
            yield data
            return
        image = image.convert('RGB')
        for top in range(0, height, TILE_SIZE):
            for left in range(0, width, TILE_SIZE):
                tile = image.crop((max(0, left - TILE_OVERLAP), max(0, top - TILE_OVERLAP),
                                   min(width, left + TILE_SIZE + TILE_OVERLAP),
                                   min(height, top + TILE_SIZE + TILE_OVERLAP)))
                buffer = BytesIO()
                tile.save(buffer, format='PNG')
                yield buffer.getvalue()


# 2단계 읽기: 감지 기준을 낮추고 영역을 더 넓게 잡는다.
# 기본 설정이 놓친 "근무시간" 줄이 실제 공고에서 이 설정으로만 읽혔다.
SENSITIVE = {"Det.box_thresh": 0.4, "Det.unclip_ratio": 2.0}


@lru_cache(maxsize=2)
def _engine(sensitive: bool = False):
    from rapidocr import EngineType, ModelType, OCRVersion, RapidOCR

    return RapidOCR(params={
        **(SENSITIVE if sensitive else {}),
        "Det.engine_type": EngineType.ONNXRUNTIME,
        "Det.model_type": ModelType.MOBILE,
        "Det.ocr_version": OCRVersion.PPOCRV5,
        "Rec.engine_type": EngineType.ONNXRUNTIME,
        "Rec.lang_type": "korean",
        "Rec.model_type": ModelType.MOBILE,
        "Rec.ocr_version": OCRVersion.PPOCRV5,
    })


def read_images(images: list[bytes], *, sensitive: bool = False) -> str:
    try:
        engine = _engine(True) if sensitive else _engine()
    except Exception as exc:
        logger.warning("그림 글자 읽기 실패: %s", exc)
        return ""
    lines = []
    for image in images:
        try:
            for tile in _image_tiles(image):
                result = engine(tile)
                lines.extend(text.strip() for text in (result.txts or ()) if text.strip())
        except Exception as exc:
            logger.warning("그림 글자 읽기 실패: %s", exc)
    return "\n".join(lines)


def _merge(first: str, extra: str) -> str:
    """처음 읽은 글에 없는 줄만 뒤에 붙인다(순서와 기존 글은 그대로 둔다)."""
    seen = {line.strip() for line in first.splitlines()}
    added = [line for line in extra.splitlines() if line.strip() and line.strip() not in seen]
    return "\n".join([first, *added]) if added else first


def _tesseract(images: list[bytes]) -> str:
    """3단계 보조 도구: 서버에 tesseract(kor)가 설치되어 있을 때만 쓴다. 없으면 빈 글을 돌려준다."""
    import shutil
    import subprocess
    import tempfile

    if not shutil.which("tesseract"):
        return ""
    out = []
    for data in images:
        with tempfile.NamedTemporaryFile(suffix=".img") as handle:
            handle.write(data)
            handle.flush()
            try:
                run = subprocess.run(["tesseract", handle.name, "-", "-l", "kor+eng", "--psm", "6"],
                                     capture_output=True, text=True, timeout=120, check=False)
            except (OSError, subprocess.SubprocessError) as exc:
                logger.warning("tesseract 실패: %s", exc)
                continue
            out.append(run.stdout)
    return "\n".join(out)


def read_until_complete(images: list[bytes], text: str, complete) -> str:
    """사슬 읽기: 처음 읽은 글이 충분하지 않으면(complete가 False) 다음 방법으로 놓친 줄을 보탠다.

    1) 기본 RapidOCR(이미 읽은 text) -> 2) 민감한 RapidOCR(감지 기준 낮춤) -> 3) tesseract(설치되어 있을 때).
    각 단계가 실패해도 앞 단계의 글은 남고, 충분해지면 멈춘다.
    """
    steps = (
        ("민감한 읽기", lambda: read_images(images, sensitive=True)),
        ("tesseract", lambda: _tesseract(images)),
    )
    for name, step in steps:
        if complete(text):
            break
        try:
            extra = step()
        except Exception as exc:
            logger.warning("%s 실패: %s", name, exc)
            continue
        text = _merge(text, extra)
    return text
