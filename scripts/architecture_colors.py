# ruff: noqa: E501  (사용법 설명과 CSS 템플릿은 한 줄에 한 항목이라 줄이 길다)
"""시스템 아키텍처 그림(assets/readme/system-architecture-dark.svg)의 색을 웹 다크 모드 토큰에서 다시 만든다.

사용: python3 scripts/architecture_colors.py          # web/src/styles/tokens.css의 다크 토큰으로 SVG의 <style>과 화살표 색을 갱신
      python3 scripts/architecture_colors.py --check  # 갱신할 내용이 있으면 1로 끝난다(웹 색이 바뀌었는데 그림이 그대로인지 확인)

기술 로고(Python, React, Supabase 등)는 브랜드 색이라 건드리지 않는다. 그림의 도형 색은 모두 SVG 안의 클래스가 정한다.
"""

import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / "web/src/styles/tokens.css"
SVG = ROOT / "assets/readme/system-architecture-dark.svg"


def oklch_hex(lightness: float, chroma: float, hue: float) -> str:
    a = chroma * math.cos(math.radians(hue))
    b = chroma * math.sin(math.radians(hue))
    l_ = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
    rgb = (
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_,
    )

    def gamma(x: float) -> float:
        return 12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055

    r, g, b = (max(0, min(255, round(gamma(v) * 255))) for v in rgb)
    return f"#{r:02x}{g:02x}{b:02x}"


def mix(a: str, b: str, t: float) -> str:
    pa = [int(a[i : i + 2], 16) for i in (1, 3, 5)]
    pb = [int(b[i : i + 2], 16) for i in (1, 3, 5)]
    r, g, b = (round(x * (1 - t) + y * t) for x, y in zip(pa, pb, strict=True))
    return f"#{r:02x}{g:02x}{b:02x}"


def dark_tokens() -> dict[str, str]:
    css = CSS.read_text(encoding="utf-8")
    hue = float(re.search(r"--h:\s*([\d.]+)", css).group(1))
    tokens = {}
    for name in ("bg", "surface", "line", "text", "text-2", "text-3", "accent"):
        line = re.search(rf"--{re.escape(name)}:\s*light-dark\(.*", css)
        values = re.findall(r"oklch\(([\d.]+)\s+([\d.]+)\s+var\(--h\)\)", line.group(0)) if line else []
        if len(values) < 2:
            raise SystemExit(f"web/src/styles/tokens.css에서 --{name}의 다크 값을 찾지 못했다")
        lightness, chroma = values[1]  # light-dark(라이트, 다크)의 두 번째가 다크
        tokens[name] = oklch_hex(float(lightness), float(chroma), hue)
    return tokens


def build_style(t: dict[str, str]) -> str:
    frame = mix(t["line"], t["text-3"], 0.45)
    bar = mix(t["line"], t["text-3"], 0.4)
    return f"""<style>
.bg{{fill:{t["bg"]};stroke:{t["line"]};stroke-width:1.5}}.fr{{fill:none;stroke:{frame};stroke-width:1.8}}
.h{{fill:{t["text"]};font-size:24px;font-weight:700}}.t{{fill:{t["text"]};font-size:21px;font-weight:700}}.s{{fill:{t["text-2"]};font-size:17px}}.m{{fill:{t["text-3"]};font-size:15.5px}}
.c{{fill:{t["text-2"]};font-size:17px;text-anchor:middle}}.cs{{fill:{t["text-3"]};font-size:15.5px;text-anchor:middle}}.cl{{fill:{t["text"]};font-size:20px;font-weight:700;text-anchor:middle}}
.ar{{fill:none;stroke:{t["accent"]};stroke-width:2.4}}.ad{{fill:none;stroke:{t["accent"]};stroke-width:2.4;stroke-dasharray:9 7}}
.card{{fill:{t["surface"]};stroke:{t["line"]};stroke-width:1.4}}.win{{fill:{t["surface"]};stroke:{t["line"]};stroke-width:1.4}}.wl{{stroke:{t["line"]};stroke-width:1.2}}
.al{{fill:{t["accent"]};font-size:16px;font-weight:600}}
.dot{{fill:{t["text-3"]}}}.us{{fill:{t["text-2"]}}}.ph{{fill:{t["surface"]};stroke:{t["text-2"]};stroke-width:2.4}}.phs{{fill:{t["bg"]}}}.pb1{{fill:{t["accent"]}}}.pb2{{fill:{bar}}}
</style>"""


def main() -> int:
    tokens = dark_tokens()
    old = SVG.read_text(encoding="utf-8")
    new = re.sub(r"<style>.*?</style>", build_style(tokens), old, flags=re.S)
    new = re.sub(
        r'(<marker id="m".*?<path d="M0 0 L10 5 L0 10 z" fill=")#[0-9a-fA-F]{6}',
        rf"\g<1>{tokens['accent']}",
        new,
        flags=re.S,
    )
    if new == old:
        print("그림의 색이 웹 다크 토큰과 같다")
        return 0
    if "--check" in sys.argv:
        print("웹 색이 바뀌었다: python3 scripts/architecture_colors.py 로 그림을 갱신한다")
        return 1
    SVG.write_text(new, encoding="utf-8")
    print("그림의 색을 갱신했다:", ", ".join(f"{k} {v}" for k, v in tokens.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
