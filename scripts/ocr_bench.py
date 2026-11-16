"""Compare local OCR results: uv run python scripts/ocr_bench.py DIR --widths 1600 1200."""

import argparse
import difflib
import re
import socket
import time
from pathlib import Path

from skku_notice import ocr

TOKENS = re.compile(r"[0-9]{1,4}[./-][0-9]{1,2}|[0-9]+시|[0-9]+:[0-9]{2}")
EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}


def positive_width(value: str) -> int:
    width = int(value)
    if width <= 0:
        raise argparse.ArgumentTypeError("width must be positive")
    return width


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--widths", type=positive_width, nargs="+", default=[1600, 1200])
    args = parser.parse_args()
    if not args.directory.is_dir():
        parser.error("directory does not exist")
    paths = sorted(p for p in args.directory.iterdir() if p.is_file() and p.suffix.lower() in EXTENSIONS)
    if not paths:
        parser.error("directory contains no supported images")

    def offline(*_args, **_kwargs):
        raise OSError("network disabled for OCR benchmark; cache models first")

    # RapidOCR can download missing models during initialization; prohibit that.
    socket.socket.connect = offline
    socket.create_connection = offline
    socket.getaddrinfo = offline
    ocr._engine()
    for path in paths:
        data = path.read_bytes()
        original = ""
        for width in [None, *args.widths]:
            ocr.OCR_MAX_WIDTH = width
            start = time.perf_counter()
            result = ocr.read_images([data])
            elapsed = time.perf_counter() - start
            if width is None:
                original = result
            preserved = set(TOKENS.findall(original)) <= set(TOKENS.findall(result))
            ratio = difflib.SequenceMatcher(None, original, result).ratio()
            print(f"{path.name}\twidth={width or 'original'}\tseconds={elapsed:.2f}"
                  f"\tchars={len(result)}\tsimilarity={ratio:.3f}\ttokens_preserved={preserved}")


if __name__ == "__main__":
    main()
