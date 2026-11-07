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


@lru_cache(maxsize=1)
def _engine():
    from rapidocr import EngineType, ModelType, OCRVersion, RapidOCR

    return RapidOCR(params={
        "Det.engine_type": EngineType.ONNXRUNTIME,
        "Det.model_type": ModelType.MOBILE,
        "Det.ocr_version": OCRVersion.PPOCRV5,
        "Rec.engine_type": EngineType.ONNXRUNTIME,
        "Rec.lang_type": "korean",
        "Rec.model_type": ModelType.MOBILE,
        "Rec.ocr_version": OCRVersion.PPOCRV5,
    })


def read_images(images: list[bytes]) -> str:
    try:
        engine = _engine()
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
