"""앱 아이콘, 화면용 SVG 스프라이트, ntfy 알림 아이콘(PNG)을 한 곳의 선 정의에서 만든다.

실행: uv run --no-project --with resvg-py python scripts/build_icons.py
웨일 확장(icampus-check-icon/gen.py)처럼 원본 선은 여기에만 두고, 결과 파일은 손으로 고치지 않는다.
"""

# ruff: noqa: E501 - SVG 경로와 생성 마크업 문자열은 줄바꿈하기 어렵다.

import re
from pathlib import Path

import resvg_py

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web" / "public"
SRC = Path(__file__).resolve().parent / "icon_src"

# 성균관대 상징색 진녹색(Pantone 3435C). 웨일 확장 아이콘과 같은 값이다.
BRAND = "#124532"
GINKGO_YELLOW = "#f2c14e"

# 24 격자, 선 1.75, 둥근 끝. 한 세트만 쓴다(웨일 DESIGN 5절).
ICONS = {
    # 은행잎(성균관대 상징): 아래 꼭짓점에서 퍼지는 부채꼴, 위 가장자리 가운데가 갈라진다.
    "ginkgo": '<path d="M12 15.5V21"/><path d="M12 15.5 3.8 8.2C5.6 5.4 8.6 4.1 11.2 4.5L12 7.6l.8-3.1c2.6-.4 5.6.9 7.4 3.7z"/>',
    "coin": '<circle cx="12" cy="12" r="8.5"/><path d="M8.2 8.8l1.6 6.4 2.2-5 2.2 5 1.6-6.4M7.6 11.6h8.8"/>',
    "briefcase": '<rect x="3.5" y="7" width="17" height="13" rx="2"/><path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7M3.5 12.5h17"/>',
    "calendar": '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8.5 3v4M15.5 3v4M4 10h16M9.5 14h5v3h-5z"/>',
    "trophy": '<path d="M8 4h8v5.5a4 4 0 0 1-8 0zM8 6H5.5v1.2A2.8 2.8 0 0 0 8 10M16 6h2.5v1.2A2.8 2.8 0 0 1 16 10M12 13.5V17M9 20h6M10 17h4v3h-4z"/>',
    "book": '<path d="M12 6.5C10.5 5 8.3 4.5 4 4.5v13c4.3 0 6.5.5 8 2 1.5-1.5 3.7-2 8-2v-13c-4.3 0-6.5.5-8 2zM12 6.5v13"/>',
    "alarm": '<circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2.5 1.5M5 4 3 6M19 4l2 2"/>',
    "search": '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
    "refresh": '<path d="M19.5 11A7.5 7.5 0 1 0 17.6 16M19.5 5v6h-6"/>',
    "plus": '<path d="M12 5v14M5 12h14"/>',
    "close": '<path d="M6 6l12 12M18 6 6 18"/>',
    "back": '<path d="M15 5l-7 7 7 7"/>',
    "panel": '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M14.5 4.5v15"/>',
    "clip": '<path d="M15.5 7.5 9 14a1.8 1.8 0 0 0 2.5 2.5L18 10a3.5 3.5 0 0 0-5-5l-6.6 6.6a5.2 5.2 0 0 0 7.4 7.4L19 14"/>',
    "list": '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
    "user-check": '<circle cx="10" cy="8" r="4"/><path d="M3.5 20a6.5 6.5 0 0 1 10.3-5.3M15 19l2 2 4-4"/>',
    # 출처: https://github.com/lucide-icons/lucide/blob/main/icons/bookmark.svg (선 굵기만 이 세트에 맞춤)
    "bookmark": '<path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/>',
    # 저장한 상태: 같은 모양을 채운다.
    "bookmark-on": '<path fill="currentColor" d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/>',
}

# 알림 종류별 아이콘 이름 (ntfy 알림과 화면 목록 앞 표시에 같이 쓴다)
NOTIFY = ["ginkgo", "coin", "briefcase", "calendar", "trophy", "book", "alarm"]

STROKE = 'fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"'


def tile(name: str, size: int = 128, radius: int = 28, scale: float = 3.3) -> str:
    """진녹색 타일 위 흰 선. 웨일 알림 아이콘(notify-*.svg)과 같은 틀이다."""
    offset = (size - 24 * scale) / 2
    stroke = STROKE.format(color="#ffffff", width=1.75)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
        f'<rect width="{size}" height="{size}" rx="{radius}" fill="{BRAND}"/>'
        f'<g transform="translate({offset:.2f} {offset:.2f}) scale({scale})" {stroke}>{ICONS[name]}</g></svg>'
    )


# 다크 모드: 바탕과 건물 안은 진녹색 그대로, 선만 맑은 초록(사용자가 보여 준 참고 아이콘에 맞춤). 바탕을 더 어둡게 하면 어두운 탭 줄에서 타일이 사라진다.
# SVG는 안에 미디어 쿼리를 넣어 스스로 바뀌고, PNG는 미디어 쿼리가 없으므로 *-dark.png를 따로 만들어
# index.html의 <link media="(prefers-color-scheme: dark)">로 골라 쓴다.
DARK_TILE = BRAND
# PNG에서 원본 선을 그릴 굵기(원본 그룹 좌표 단위). 128용은 128px에서 약 2.4px, 32용은 32px에서 약 1.4px가 되게 맞췄다.
PNG_STROKE = {128: 16, 32: 28}
DARK_LINE = "#4fd896"
DARK_STYLE = (
    "<style>@media (prefers-color-scheme: dark){"
    f".tile{{fill:{DARK_TILE}}}.art{{stroke:{DARK_LINE}}}.ring{{stroke:{DARK_TILE}}}}}</style>"
)


def library_art(size: int) -> str:
    """아캠 플러스 아이콘의 지붕 선 묶음(<g>)만 꺼낸다. 128은 층 띠까지, 32는 단순화한 선."""
    text = (SRC / f"library{size}.svg").read_text(encoding="utf-8")
    return re.search(r"<g .*</g>", text, re.S).group()


def app_icon(size: int, full_bleed: bool, variant: str = "auto", small: bool = False) -> str:
    """아캠 플러스 지붕 선 위에, 새 공지를 뜻하는 노랗게 물든 은행잎 점을 얹는다.

    full_bleed는 안드로이드 maskable(가장자리가 잘림)용이고, 아니면 웨일 아이콘처럼 둥근 타일이다.
    점은 maskable 안전 영역(가운데 반지름 40%) 안에 둔다.
    """
    # small: 탭 아이콘(16px)과 사이드바(24px)처럼 작게 그려지는 SVG. 단순화한 선을 1px로 가늘게 그려 선끼리 뭉치지 않게 한다
    # (사용자 요청 "1을 2처럼": 굵은 선이 뭉쳐 건물이 허옇게 채워져 보였다).
    base = 32 if small or size < 96 else 128
    art = library_art(base)
    if small:
        art = re.sub(r'stroke-width="[\d.]+"', 'stroke-width="1"', art)
    background = (
        f'<rect width="128" height="128" fill="{BRAND}"/>'
        if full_bleed
        else f'<rect width="128" height="128" rx="28" fill="{BRAND}"/>'
    )
    # 원본은 선 굵기가 화면 픽셀 고정(non-scaling-stroke)이다. 브라우저용 SVG(auto)는 그대로 두고,
    # PNG를 굽는 resvg는 이 속성을 무시하고 그룹 축소 비율(약 0.15)로 선을 가늘게 그리므로 속성을 빼고 굵기를 다시 준다.
    if variant != "auto":
        art = art.replace(' vector-effect="non-scaling-stroke"', "")
        art = re.sub(r'stroke-width="[\d.]+"', f'stroke-width="{PNG_STROKE[base]}"', art)
    dot = f'<circle class="ring" cx="96" cy="37" r="7.5" fill="{GINKGO_YELLOW}" stroke="{BRAND}" stroke-width="3"/>'
    background = background.replace("<rect ", '<rect class="tile" ', 1)
    art = art.replace("<g ", '<g class="art" ', 1)
    style = DARK_STYLE if variant == "auto" else ""
    if variant == "dark":
        background = background.replace(f'fill="{BRAND}"', f'fill="{DARK_TILE}"')
        art = art.replace('stroke="#ffffff"', f'stroke="{DARK_LINE}"')
        dot = dot.replace(f'stroke="{BRAND}"', f'stroke="{DARK_TILE}"')
    if variant == "monochrome":
        background = ""
        dot = '<circle cx="96" cy="37" r="7.5" fill="#ffffff"/>'
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 128 128">'
        f"{style}{background}{art}{dot}</svg>"
    )


def brand_symbol() -> str:
    """배경 없는 아캠 플러스 선(currentColor). 앱 안 사이드바처럼 화면 바탕 위에 그릴 때 쓴다(웨일 popup-inline.svg와 같은 방식).
    사용자 요청: "아이콘 배경색을 배경색이랑 동일하게"."""
    art = library_art(32)
    art = re.sub(r'stroke="#ffffff"', 'stroke="currentColor"', art)
    art = re.sub(r'stroke-width="[\d.]+"', 'stroke-width="1.4"', art)
    dot = f'<circle cx="96" cy="37" r="7.5" fill="{GINKGO_YELLOW}"/>'
    return f'<symbol id="brand" viewBox="0 0 128 128">{art}{dot}</symbol>'


def sprite() -> str:
    stroke = STROKE.format(color="currentColor", width=1.75)
    symbols = "".join(f'<symbol id="{name}" viewBox="0 0 24 24" {stroke}>{body}</symbol>' for name, body in ICONS.items())
    return f'<svg xmlns="http://www.w3.org/2000/svg">{symbols}{brand_symbol()}</svg>\n'


def png(svg: str, path: Path, size: int) -> None:
    path.write_bytes(bytes(resvg_py.svg_to_bytes(svg_string=svg, width=size, height=size)))


def main() -> None:
    (WEB / "icons" / "notify").mkdir(parents=True, exist_ok=True)
    (WEB / "favicon.svg").write_text(app_icon(32, full_bleed=False, small=True) + "\n", encoding="utf-8")
    (WEB / "icon.svg").write_text(app_icon(128, full_bleed=False, small=True) + "\n", encoding="utf-8")
    for suffix, variant in (("", "light"), ("-dark", "dark")):
        for size in (48, 192, 512):
            png(app_icon(size, False, variant), WEB / f"icon-{size}{suffix}.png", size)
        png(app_icon(512, True, variant), WEB / f"icon-maskable-512{suffix}.png", 512)
        png(app_icon(180, True, variant), WEB / f"apple-touch-icon{suffix}.png", 180)
    png(app_icon(512, True, "monochrome"), WEB / "icon-monochrome-512.png", 512)
    (WEB / "icons" / "sprite.svg").write_text(sprite(), encoding="utf-8")
    for name in NOTIFY:
        svg = tile(name)
        (WEB / "icons" / "notify" / f"{name}.svg").write_text(svg + "\n", encoding="utf-8")
        png(svg, WEB / "icons" / "notify" / f"{name}.png", 256)


if __name__ == "__main__":
    main()
