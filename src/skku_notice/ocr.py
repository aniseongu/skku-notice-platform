"""Read text from public notice images with a lazy local OCR engine."""

import logging
from functools import lru_cache

logger = logging.getLogger(__name__)


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
            result = engine(image)
            lines.extend(text.strip() for text in (result.txts or ()) if text.strip())
        except Exception as exc:
            logger.warning("그림 글자 읽기 실패: %s", exc)
    return "\n".join(lines)
