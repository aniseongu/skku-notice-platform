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


LINE_OVERLAP = 0.5  # 세로로 이 비율 이상 겹치면 같은 줄
LINE_GAP = 3.0  # 같은 줄에서 상자 사이 간격이 글자 높이의 이 배수를 넘으면 다른 칸(단)으로 본다


def _bounds(box) -> tuple[float, float, float, float]:
    xs = [float(point[0]) for point in box]
    ys = [float(point[1]) for point in box]
    return min(xs), min(ys), max(xs), max(ys)


def stitch_lines(boxes, texts) -> list[str]:
    """같은 시각 줄에서 감지기가 단어 사이 간격마다 쪼갠 상자를 한 줄로 잇는다.

    MMOCR의 stitch_boxes_into_lines(Apache-2.0, open-mmlab/mmocr)의 방식을 따른다:
    세로 겹침 비율이 충분한 이웃 상자를 한 줄로 묶고, 가로 간격이 줄 높이에 비해 크면 잇지 않으며,
    줄은 위에서 아래로, 줄 안은 왼쪽에서 오른쪽으로 놓는다. 서로 먼 두 단은 따로 둔다.
    """
    items = []
    for box, text in zip(boxes, texts, strict=False):
        text = str(text).strip()
        if text:
            x0, y0, x1, y1 = _bounds(box)
            items.append((x0, y0, x1, y1, text))
    items.sort(key=lambda item: item[1] + item[3])
    rows: list[list[tuple]] = []
    spans: list[list[float]] = []
    for item in items:
        _, y0, _, y1, _ = item
        for row, span in zip(rows, spans, strict=True):
            overlap = min(y1, span[1]) - max(y0, span[0])
            if overlap >= LINE_OVERLAP * min(y1 - y0, span[1] - span[0]) and overlap > 0:
                row.append(item)
                span[0], span[1] = min(span[0], y0), max(span[1], y1)
                break
        else:
            rows.append([item])
            spans.append([y0, y1])
    lines: list[tuple[float, str]] = []
    for row in rows:
        row.sort(key=lambda item: item[0])
        group = [row[0]]
        groups = [group]
        for item in row[1:]:
            height = max(group[-1][3] - group[-1][1], item[3] - item[1])
            if item[0] - max(member[2] for member in group) <= LINE_GAP * height:
                group.append(item)
            else:
                group = [item]
                groups.append(group)
        for group in groups:
            top = min(member[1] for member in group)
            lines.append((top, " ".join(member[4] for member in group)))
    lines.sort(key=lambda line: line[0])
    return [text for _, text in lines]


def _tile_lines(result) -> list[str]:
    texts = result.txts or ()
    boxes = getattr(result, "boxes", None)
    if boxes is None or len(boxes) != len(texts):
        return [text.strip() for text in texts if text.strip()]
    return stitch_lines(boxes, texts)


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
                lines.extend(_tile_lines(result))
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
