# ruff: noqa: E501  (게시판 표는 한 줄에 한 항목이라 줄이 길다)
"""단과대·학과 공지 게시판 카탈로그. 이 목록 한 곳에서 config/sources.yaml과 web/src/skku-boards.ts를 만든다.

사용: uv run python scripts/board_catalog.py generate   # 두 파일을 다시 만든다
      uv run python scripts/board_catalog.py verify     # 모든 게시판을 우리 파서로 다시 확인한다(요청 간격 1.2초)

각 항목은 2026-11-07에 학교 공개 페이지에서 찾아 우리 파서로 읽히는 것을 확인했다. robots.txt가 전체를 막거나
로그인이 필요하거나 파서가 읽지 못한 게시판은 넣지 않았다(사범대학, 약학대학, 의과대학, 화학과, 나노공학과 등).
"""

import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# (id, 이름, 주소). 이미 운영 중인 4개(skku-notice01, cse-notice, sw-notice, futurecar-notice)는 sources.yaml에 따로 있다.
BOARDS: list[tuple[str, str, str]] = [
    ("liberalarts-notice", "문과대학 공지", "https://liberalarts.skku.edu/liberal/community/under_notice.do"),
    ("sscience-notice", "사회과학대학 공지", "https://sscience.skku.edu/sscience/community/under_notice.do"),
    ("ecostat-notice", "경제대학 공지", "https://ecostat.skku.edu/ecostat/notice_total.do"),
    ("biz-notice", "경영대학 공지", "https://biz.skku.edu/bizskk/notice.do"),
    ("art-notice", "예술대학 공지", "https://art.skku.edu/art/notice.do"),
    ("cscience-notice", "자연과학대학 공지", "https://cscience.skku.edu/cscience/community/under_notice.do"),
    ("ice-notice", "정보통신대학 공지", "https://ice.skku.edu/ice/notice.do"),
    ("enc-notice", "공과대학 공지", "https://enc.skku.edu/enc/notice.do"),
    ("biotech-notice", "생명공학대학 공지", "https://biotech.skku.edu/biotech/notice_under.do"),
    ("sports-notice", "스포츠과학대학 공지", "https://sport.skku.edu/sports/community/under_notice.do"),
    ("scos-notice", "유학대학 공지", "https://scos.skku.edu/scos/community/under_notice.do"),
    ("korean-notice", "국어국문학과 공지", "https://skb.skku.edu/korean/community/under_notice.do"),
    ("english-notice", "영어영문학과 공지", "https://skb.skku.edu/english/notice.do"),
    ("french-notice", "프랑스어문학과 공지", "https://skb.skku.edu/french/community/notice.do"),
    ("chinese-notice", "중어중문학과 공지", "https://skb.skku.edu/chinese/undergraduate_notice.do"),
    ("german-notice", "독어독문학과 공지", "https://skb.skku.edu/german/04_Community/notice.do"),
    ("russian-notice", "러시아어문학과 공지", "https://russian.skku.edu/russian/deptnews.do"),
    ("klcc-notice", "한문학과 공지", "https://skb.skku.edu/klcc/community/under_notice.do"),
    ("history-notice", "사학과 공지", "https://history.skku.edu/history/community/under_notice.do"),
    ("philosophy-notice", "철학과 공지", "https://skb.skku.edu/philosophy/community/under_notice.do"),
    ("lis-notice", "문헌정보학과 공지", "https://lis.skku.edu/lis/community/under_notice.do"),
    ("psd-notice", "정치외교학과 공지", "https://skb.skku.edu/psd/notice.do"),
    ("mediacomm-notice", "미디어커뮤니케이션학과 공지", "https://mediacomm.skku.edu/mediacomm/community/notice.do"),
    ("soc-notice", "사회학과 공지", "https://soc.skku.edu/soc/notice.do"),
    ("welfare-notice", "사회복지학과 공지", "https://skb.skku.edu/welfare/community/notice.do"),
    ("psych-notice", "심리학과 공지", "https://psych.skku.edu/psy/notice_undergraduate.do"),
    ("child-notice", "아동·청소년학과 공지", "https://skb.skku.edu/child/notice.do"),
    ("gld-notice", "글로벌리더학부 공지", "https://gld.skku.edu/gld/community/notice.do"),
    ("stat-notice", "통계학과 공지", "https://stat.skku.edu/stat/community/under_notice.do"),
    ("globalecon-notice", "글로벌경제학과 공지", "https://globalecon.skku.edu/gecon/notice.do"),
    ("bus-notice", "경영학과 공지", "https://skb.skku.edu/bus/notice.do"),
    ("globalbiz-notice", "글로벌경영학과 공지", "https://globalbiz.skku.edu/gba/notice.do"),
    ("edu-notice", "교육학과 공지", "https://skb.skku.edu/skku-edu/community/under_notice.do"),
    ("klccedu-notice", "한문교육과 공지", "https://skb.skku.edu/klccedu/community/notice.do"),
    ("mathedu-notice", "수학교육과 공지", "https://skb.skku.edu/mathedu/notice.do"),
    ("comedu-notice", "컴퓨터교육과 공지", "https://comedu.skku.edu/comedu/notice.do"),
    ("design-notice", "디자인학과 공지", "https://design.skku.edu/design/notice_dept.do"),
    ("dance-notice", "무용학과 공지", "https://dance.skku.edu/dance/notice.do"),
    ("acting-notice", "연기예술학과 공지", "https://acting.skku.edu/acting/notice.do"),
    ("fashion-notice", "의상학과 공지", "https://fashion.skku.edu/fashion/notice.do"),
    ("math-notice", "수학과 공지", "https://math.skku.edu/math/community/under_notice.do"),
    ("physics-notice", "물리학과 공지", "https://physics.skku.edu/physics/notice/notice.do"),
    ("eee-notice", "전자전기공학부 공지", "https://eee.skku.edu/eee/notice.do"),
    ("mcce-notice", "소재부품융합공학과 공지", "https://skb.skku.edu/mcce/notice.do"),
    ("intelligentsw-notice", "지능형소프트웨어학과 공지", "https://intelligentsw.skku.edu/intelligentsw/notice.do"),
    ("ai-notice", "인공지능학과 공지", "https://ai.skku.edu/ai/notice.do"),
    ("amse-notice", "신소재공학부 공지", "https://amse.skku.edu/AMSE/notice.do"),
    ("mech-notice", "기계공학부 공지", "https://mech.skku.edu/me/notice.do"),
    ("sme-notice", "시스템경영공학과 공지", "https://sme.skku.edu/iesys/notice.do"),
    ("arch-notice", "건축학과 공지", "https://arch.skku.edu/arch/NEWS/notice.do"),
    ("qie-notice", "양자정보공학과 공지", "https://qie.skku.edu/qie/notice.do"),
    ("foodlife-notice", "식품생명공학과 공지", "https://skb.skku.edu/foodlife/community/notice.do"),
    ("biomecha-notice", "바이오메카트로닉스학과 공지", "https://skb.skku.edu/biomecha/community/notice.do"),
    ("gene-notice", "융합생명공학과 공지", "https://skb.skku.edu/gene/community/under_notice.do"),
    ("gbme-notice", "글로벌바이오메디컬공학과 공지", "https://gbme.skku.edu/gbme/community/under_notice.do"),
    ("aicon-notice", "응용AI융합학부 공지", "https://aicon.skku.edu/aicon/notice.do"),
    ("energy-notice", "에너지학과 공지", "https://energy.skku.edu/energy/notice.do"),
    ("ssbat-notice", "배터리학과 공지", "https://ssbat.skku.edu/ssbat/notice.do"),
]

# 단과대학 이름 -> 게시판 id (이미 있는 sw-notice 포함)
COLLEGE_BOARD = {
    "문과대학": "liberalarts-notice", "사회과학대학": "sscience-notice", "경제대학": "ecostat-notice", "경영대학": "biz-notice",
    "예술대학": "art-notice", "자연과학대학": "cscience-notice", "정보통신대학": "ice-notice", "소프트웨어융합대학": "sw-notice",
    "공과대학": "enc-notice", "생명공학대학": "biotech-notice", "스포츠과학대학": "sports-notice", "유학대학": "scos-notice",
}

# "대학/학과" -> 게시판 id. 학과 게시판이 없는 학과는 단과대학 게시판만 추천한다.
DEPARTMENT_BOARD = {
    "문과대학/국어국문학과": "korean-notice", "문과대학/영어영문학과": "english-notice", "문과대학/프랑스어문학과": "french-notice",
    "문과대학/중어중문학과": "chinese-notice", "문과대학/독어독문학과": "german-notice", "문과대학/러시아어문학과": "russian-notice",
    "문과대학/한문학과": "klcc-notice", "문과대학/사학과": "history-notice", "문과대학/철학과": "philosophy-notice",
    "문과대학/문헌정보학과": "lis-notice",
    "사회과학대학/정치외교학과": "psd-notice", "사회과학대학/미디어커뮤니케이션학과": "mediacomm-notice",
    "사회과학대학/사회학과": "soc-notice", "사회과학대학/사회복지학과": "welfare-notice", "사회과학대학/심리학과": "psych-notice",
    "사회과학대학/아동·청소년학과": "child-notice", "사회과학대학/글로벌리더학부": "gld-notice",
    "경제대학/통계학과": "stat-notice", "경제대학/글로벌경제학과": "globalecon-notice",
    "경영대학/경영학과": "bus-notice", "경영대학/글로벌경영학과": "globalbiz-notice",
    "사범대학/교육학과": "edu-notice", "사범대학/한문교육과": "klccedu-notice", "사범대학/수학교육과": "mathedu-notice",
    "사범대학/컴퓨터교육과": "comedu-notice",
    "예술대학/디자인학과": "design-notice", "예술대학/무용학과": "dance-notice", "예술대학/연기예술학과": "acting-notice",
    "예술대학/의상학과": "fashion-notice",
    "자연과학대학/수학과": "math-notice", "자연과학대학/물리학과": "physics-notice",
    "정보통신대학/전자전기공학부": "eee-notice", "정보통신대학/소재부품융합공학과": "mcce-notice",
    "소프트웨어융합대학/소프트웨어학과": "cse-notice", "소프트웨어융합대학/지능형소프트웨어학과": "intelligentsw-notice",
    "소프트웨어융합대학/인공지능학과": "ai-notice",
    "공과대학/신소재공학부": "amse-notice", "공과대학/기계공학부": "mech-notice", "공과대학/시스템경영공학과": "sme-notice",
    "공과대학/건축학과(건축학계열)": "arch-notice", "공과대학/양자정보공학과": "qie-notice",
    "생명공학대학/식품생명공학과": "foodlife-notice", "생명공학대학/바이오메카트로닉스학과": "biomecha-notice",
    "생명공학대학/융합생명공학과": "gene-notice",
    "성균융합원/글로벌바이오메디컬공학과": "gbme-notice", "성균융합원/응용AI융합학부": "aicon-notice",
    "성균융합원/에너지학과": "energy-notice", "성균융합원/배터리학과": "ssbat-notice",
    "스포츠과학대학/스포츠과학과": "sports-notice", "경제대학/경제학과": "ecostat-notice",
}

# 전공과 상관없이 누구나 고를 수 있는 게시판(온보딩의 "기타 게시판" 단계). (id, 묶음, 설명)
# 부트캠프 모집 안내(청년도약·첨단산업 인재양성)는 성균관대 공지 전체 게시판에도 올라온다. 아래는 사업단이 따로 올리는 게시판이다.
# 디스플레이 부트캠프 사업단은 공개 공지 게시판을 찾지 못했고, 인공지능·반도체 사업단은 주소가 확인되지 않아 넣지 않았다.
OTHER_BOARDS: list[tuple[str, str, str]] = [
    ("futurecar-notice", "부트캠프", "수강 모집과 행사 안내"),
]

# 이미 운영 중인 기본 게시판(모든 사용자에게 추천). sources.yaml의 앞쪽 4개는 이 스크립트가 건드리지 않는다.
DEFAULT_BOARD = "skku-notice01"
EXISTING = {
    "skku-notice01": "성균관대 공지", "cse-notice": "소프트웨어학과 공지", "sw-notice": "소프트웨어융합대학 공지",
    "futurecar-notice": "미래차 부트캠프 공지",
}

BEGIN, END = "# BEGIN catalog", "# END catalog"


def check() -> None:
    ids = [board_id for board_id, _, _ in BOARDS]
    assert len(set(ids)) == len(ids), "duplicate board id"
    assert all(re.fullmatch(r"[a-z0-9-]+", i) for i in ids), "invalid board id"
    urls = [url for _, _, url in BOARDS]
    assert len(set(urls)) == len(urls), "duplicate board url"
    assert all(url.startswith("https://") and ".skku.edu/" in url for url in urls), "unexpected host"
    known = set(ids) | set(EXISTING)
    assert all(i in known for i, _, _ in OTHER_BOARDS), "unknown other board"
    for target in [*COLLEGE_BOARD.values(), *DEPARTMENT_BOARD.values()]:
        assert target in known, f"unknown board {target}"


def sources_block() -> str:
    lines = [BEGIN, "# scripts/board_catalog.py가 만든다. 직접 고치지 않는다. 구독자가 있는 게시판만 수집한다(on_demand).", ""]
    for board_id, name, url in BOARDS:
        lines += [f"  - id: {board_id}", f"    name: {name}", "    kind: skku-cms", f"    url: {url}", "    on_demand: true", ""]
    lines.append(END)
    return "\n".join(lines)


def typescript() -> str:
    entries = [f"  {{ id: '{i}', name: '{n}', url: '{u}' }}," for i, n, u in BOARDS]
    college = [f"  '{k}': '{v}'," for k, v in COLLEGE_BOARD.items()]
    department = [f"  '{k}': '{v}'," for k, v in DEPARTMENT_BOARD.items()]
    return "\n".join([
        "// scripts/board_catalog.py가 만든 파일이다. 직접 고치지 않는다.",
        "// 단과대학·학과 공지 게시판. 2026-11-07에 학교 공개 페이지에서 찾아 수집 파서로 읽히는 것을 확인했다.",
        "import type { Program } from './skku-programs.ts';",
        "",
        "export interface BoardRef { id: string; name: string; url: string }",
        f"export const DEFAULT_BOARD = '{DEFAULT_BOARD}';",
        "export const BOARD_CATALOG: readonly BoardRef[] = [",
        *entries,
        "];",
        "",
        "/** 전공과 상관없이 고르는 게시판(부트캠프 등). */",
        "export interface OtherBoard { id: string; group: string; help: string }",
        "export const OTHER_BOARDS: readonly OtherBoard[] = [",
        *[f"  {{ id: '{i}', group: '{g}', help: '{h}' }}," for i, g, h in OTHER_BOARDS],
        "];",
        "",
        "export const COLLEGE_BOARD: Readonly<Record<string, string>> = {",
        *college,
        "};",
        "",
        "export const DEPARTMENT_BOARD: Readonly<Record<string, string>> = {",
        *department,
        "};",
        "",
        "/** 전공에 맞는 게시판. 성균관대 공지는 항상 넣고, 전공마다 학과 게시판과 단과대학 게시판을 더한다(없는 것은 건너뛴다). */",
        "export function boardsForPrograms(programs: readonly Program[]): string[] {",
        "  const ids = [DEFAULT_BOARD];",
        "  for (const program of programs) {",
        "    const department = program.department ? DEPARTMENT_BOARD[`${program.college}/${program.department}`] : undefined;",
        "    const college = COLLEGE_BOARD[program.college];",
        "    for (const id of [department, college]) if (id && !ids.includes(id)) ids.push(id);",
        "  }",
        "  return ids;",
        "}",
        "",
    ])


def generate() -> None:
    check()
    path = ROOT / "config" / "sources.yaml"
    text = path.read_text(encoding="utf-8")
    block = sources_block()
    if BEGIN in text:
        text = re.sub(re.escape(BEGIN) + r".*?" + re.escape(END), lambda _: block, text, flags=re.S)
    else:
        text = text.rstrip("\n") + "\n\n" + block + "\n"
    path.write_text(text, encoding="utf-8")
    (ROOT / "web" / "src" / "skku-boards.ts").write_text(typescript(), encoding="utf-8")
    print(f"wrote {len(BOARDS)} boards")


def verify() -> int:
    import httpx

    from skku_notice.parse import ParseError, parse_list

    agent = "skku-notice-platform/0.1 (+https://github.com/aniseongu/skku-notice-platform)"
    failed = 0
    with httpx.Client(headers={"User-Agent": agent, "Accept-Language": "ko"}, timeout=10, follow_redirects=True) as client:
        for board_id, _name, url in BOARDS:
            time.sleep(1.2)
            try:
                response = client.get(url)
                response.encoding = "utf-8"
                if "login.skku.edu" in str(response.url):
                    raise ParseError("login required")
                count = len(parse_list(response.text, board_id, url))
                print(f"ok   {board_id} {count}")
            except (httpx.HTTPError, ParseError) as exc:
                failed += 1
                print(f"FAIL {board_id} {type(exc).__name__}")
    return int(failed > 0)


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "generate":
        generate()
    elif mode == "verify":
        sys.exit(verify())
    else:
        print(__doc__)
        sys.exit(1)
