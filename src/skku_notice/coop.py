# ruff: noqa: E501  (한국어 표 이름과 SQL은 한 줄에 한 항목이라 줄이 길다)
"""성대 톨게이트(현장실습) 수집 JSON을 공지 한 건씩으로 바꾼다. 네트워크는 쓰지 않는다.

입력은 사용자가 로그인한 브라우저 창에서 저장한 JSON이다(`rounds[].rows[]`에 jidSeq, 목록 칸 10개, 상세 HTML).
정해 둔 칸(th 이름)만 읽고 나머지는 무시한다. 목록의 "신청" 칸처럼 개인 상태는 읽지 않는다.
"""

import re
from collections import Counter
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta, timezone
from html import escape

import nh3
from selectolax.lexbor import LexborHTMLParser, LexborNode

KST = timezone(timedelta(hours=9))
SOURCE_ID = "skku-coop"
SOURCE_URL = "https://tollgate.skku.edu/student/manage/search/index.do"
HTML_TAGS = {"h3", "p", "ul", "li", "strong", "br"}

JID_RE = re.compile(r"^\d{1,12}$")
DATETIME_RE = re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?")
FULL_PERIOD_RE = re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})\s*~\s*(\d{4})-(\d{1,2})-(\d{1,2})")
SHORT_PERIOD_RE = re.compile(r"(\d{2})\.(\d{1,2})\.(\d{1,2})\s*~\s*(\d{2})\.(\d{1,2})\.(\d{1,2})")
TARGET_RE = re.compile(r"\[([^/\]]*)/\s*(\d+)\s*명\s*/\s*([^\]]*)\]")
LIST_LINE_RE = re.compile(r"^(?:[*•]|-(?!\d))\s*(.+)$")
WEEKDAYS = "월화수목금토일"

# 상세 표에서 읽는 칸. 공백을 모두 뺀 th 이름 -> 내부 키.
FIELDS = {
    "학교안내사항": "school_note", "정규실습시간": "hours", "실습기간": "period", "실습요일": "days",
    "연장실습여부": "extended", "근로계약체결여부": "contract", "전형방법": "method", "접수마감일자": "deadline",
    "면접일자": "interview", "최종선발일자": "final", "참고일정": "schedule", "선발대상/학생평가교수": "targets",
    "총모집인원": "headcount", "학생요건요구역량": "skills", "학생요건기타사항": "etc",
    "실습지원비(정규실습시간)": "pay", "실습지원비(연장실습시간)": "pay_extra", "실습지원비지급예정일": "pay_day",
    "기타지원사항": "support", "직무명": "job", "교육목표": "goal", "직무개요": "overview", "운영/지도계획": "plan",
}


@dataclass(frozen=True)
class CoopNotice:
    id: str
    article_no: str
    title: str
    category: str | None
    deadline: datetime | None
    expires_at: datetime | None
    practice_start: date | None
    practice_end: date | None
    body: str
    body_html: str
    dept: str = ""
    url: str = SOURCE_URL


def _lines(text: str) -> list[str]:
    """줄마다 공백을 정리하고, "-"만 있는 줄과 앞뒤·연속 빈 줄을 뺀다."""
    out: list[str] = []
    for raw in text.replace("\r", "").split("\n"):
        line = re.sub(r"[ \t\xa0]+", " ", raw).strip()
        if line == "-":
            continue
        if not line and (not out or not out[-1]):
            continue
        out.append(line)
    while out and not out[-1]:
        out.pop()
    return out


def _plain(html: str) -> str:
    """HTML 조각을 줄바꿈이 남은 글자로 바꾼다(칸은 pre-wrap이라 줄바꿈이 뜻을 가진다)."""
    html = re.sub(r"<br\s*/?>", "\n", html, flags=re.I)
    html = re.sub(r"</(?:p|div|li|tr|ul)>", "\n", html, flags=re.I)
    html = re.sub(r"<label\b", " <label", html, flags=re.I)
    return LexborHTMLParser(f"<body>{html}</body>").text(strip=False)


def _clean_text(text: str) -> str:
    return "\n".join(_lines(text))


def _cell_text(html: str) -> str:
    return _clean_text(_plain(html or ""))


def _value(td: LexborNode, key: str) -> str:
    """상세 칸 한 개의 값을 글자로 꺼낸다. 체크하지 않은 입력과 그 이름표는 버린다."""
    node = LexborHTMLParser(f"<body>{td.html}</body>")
    checked_days: list[str] = []
    checked_radio: list[str] = []
    for box in node.css("input"):
        label = node.css_first(f'label[for="{box.attributes.get("id")}"]') if box.attributes.get("id") else None
        if "checked" in box.attributes and label is not None:
            text = label.text(strip=True)
            (checked_days if box.attributes.get("type") == "checkbox" and key == "days" else checked_radio).append(text)
        if label is not None:
            label.decompose()
        box.decompose()
    if key == "days":
        return _weekdays(checked_days)
    if key == "contract":
        return " / ".join(checked_radio)
    # 날짜와 체크한 "일정별도 협의"가 함께 있으면 붙지 않게 쉼표로 나눈다("2026-11-29 00:00, 일정별도 협의").
    text = _clean_text(_plain(node.body.inner_html if node.body else ""))
    parts = [x for x in [text, *checked_radio] if x and x != "-"]
    return ", ".join(parts)


def _weekdays(labels: list[str]) -> str:
    picked = sorted({WEEKDAYS.index(x) for x in labels if x in WEEKDAYS and len(x) == 1})
    if not picked:
        return ""
    if len(picked) >= 3 and picked == list(range(picked[0], picked[-1] + 1)):
        return f"{WEEKDAYS[picked[0]]}~{WEEKDAYS[picked[-1]]}"
    return "·".join(WEEKDAYS[i] for i in picked)


def _detail_fields(detail: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    if not detail:
        return fields
    for th in LexborHTMLParser(detail).css("th"):
        key = FIELDS.get(re.sub(r"\s+", "", th.text()))
        row = th.parent
        td = next((c for c in row.iter() if c.tag == "td"), None) if row is not None else None
        if key is None or td is None or key in fields:
            continue
        value = _value(td, key)
        if value:
            fields[key] = value
    return fields


def _kst(y: int, m: int, d: int, hh: int = 0, mm: int = 0) -> datetime | None:
    try:
        return datetime(y, m, d, hh, mm, tzinfo=KST)
    except ValueError:
        return None


def _parse_deadline(*texts: str | None) -> datetime | None:
    """"2026-11-27 00:00"은 그대로, 날짜만 있으면 그날 23:59로 본다. "-"나 "일정별도 협의"만 있으면 없음."""
    for text in texts:
        match = DATETIME_RE.search(text or "")
        if match:
            y, m, d, hh, mm = match.groups()
            found = _kst(int(y), int(m), int(d), int(hh), int(mm)) if hh else _kst(int(y), int(m), int(d), 23, 59)
            if found:
                return found
    return None


def _parse_period(*texts: str | None) -> tuple[date | None, date | None]:
    for text in texts:
        text = text or ""
        full, short = FULL_PERIOD_RE.search(text), SHORT_PERIOD_RE.search(text)
        try:
            if full:
                a, b, c, x, y, z = (int(v) for v in full.groups())
                return date(a, b, c), date(x, y, z)
            if short:
                a, b, c, x, y, z = (int(v) for v in short.groups())
                return date(2000 + a, b, c), date(2000 + x, y, z)
        except ValueError:
            continue
    return None, None


def _targets(value: str) -> str:
    """"[전체학과 / 1 명 / 무관] / 평가교수 :"를 "전체학과 1명 (학년 무관)"으로. 같은 항목은 한 번만."""
    seen: list[str] = []
    unnamed: list[str] = []
    for dept, count, grade in TARGET_RE.findall(value):
        grade = grade.strip()
        who = f"{dept.strip()} ({'학년 무관' if grade in ('', '무관') else grade})"
        # 인원 0인 줄은 인원을 정하지 않은 칸이다(총 모집인원은 따로 있다). 인원이 있는 줄이 없을 때만 대상만 보인다.
        target, line = (unnamed, who) if int(count) == 0 else (seen, f"{dept.strip()} {count}명 ({'학년 무관' if grade in ('', '무관') else grade})")
        if line not in target:
            target.append(line)
    if seen or unnamed:
        return "\n".join(seen or unnamed)
    return re.sub(r"\s*/?\s*평가교수\s*:\s*", "", value).strip()


def _money(value: str) -> str:
    return re.sub(r"(\d) 원", r"\1원", value)


def _item_html(label: str, value: str, bold_value: bool = False) -> str:
    lines = value.split("\n")
    if bold_value:
        return f"<p><strong>{escape(value, quote=False)}</strong></p>"
    if len(lines) == 1 and not LIST_LINE_RE.match(lines[0]):
        return f"<p><strong>{escape(label, quote=False)}</strong> {escape(value, quote=False)}</p>"
    return f"<p><strong>{escape(label, quote=False)}</strong></p>" + _lines_html(lines)


def _lines_html(lines: list[str]) -> str:
    """목록처럼 보이는 줄(-, *, •)은 ul/li로, 나머지는 줄바꿈(br)이 있는 문단으로."""
    out: list[str] = []
    para: list[str] = []
    items: list[str] = []

    def flush_para() -> None:
        if para:
            out.append("<p>" + "<br>".join(escape(x, quote=False) for x in para) + "</p>")
            para.clear()

    def flush_items() -> None:
        if items:
            out.append("<ul>" + "".join(f"<li>{escape(x, quote=False)}</li>" for x in items) + "</ul>")
            items.clear()

    for line in lines:
        match = LIST_LINE_RE.match(line)
        if match:
            flush_para()
            items.append(match.group(1).strip())
        elif line:
            flush_items()
            para.append(line)
        else:
            flush_items()
            flush_para()
    flush_items()
    flush_para()
    return "".join(out)


def _build_body(sections: list[tuple[str, list[tuple[str, str, bool]]]]) -> tuple[str, str]:
    text_parts: list[str] = []
    html_parts: list[str] = []
    seen: set[str] = set()
    for title, items in sections:
        kept: list[tuple[str, str, bool]] = []
        for label, value, bold in items:
            value = _clean_text(value)
            norm = re.sub(r"\s+", "", value)
            if not norm:
                continue
            if len(norm) > 20 and norm in seen:   # 칸마다 같은 문장을 되풀이하는 공고가 많다
                continue
            seen.add(norm)
            kept.append((label, value, bold))
        if not kept:
            continue
        html_parts.append(f"<h3>{escape(title, quote=False)}</h3>")
        lines = [title]
        for label, value, bold in kept:
            html_parts.append(_item_html(label, value, bold))
            lines.append(f"{label}: {value}" if "\n" not in value else f"{label}:\n{value}")
        text_parts.append("\n".join(lines))
    html = nh3.clean("".join(html_parts), tags=HTML_TAGS, attributes={}, link_rel=None)
    return "\n\n".join(text_parts), html


def _title(org: str, job: str, dept: str, jid: str) -> str:
    tail = job or dept
    if org and tail:
        return f"{org} · {tail}"
    return org or tail or f"현장실습 {jid}"


def parse_row(row: dict, imported_at: datetime) -> CoopNotice | None:
    jid = str(row.get("jidSeq", "")).strip()
    if not JID_RE.match(jid):
        return None
    cells = list(row.get("cells") or [])
    cells += [""] * (10 - len(cells))
    industry, category, org, dept, place, period_cell, deadline_cell = (_cell_text(c) for c in cells[:7])
    org, dept, place, industry = (x.replace("\n", " ") for x in (org, dept, place, industry))
    f = _detail_fields(str(row.get("detail") or ""))

    start, end = _parse_period(f.get("period"), period_cell)
    deadline = _parse_deadline(f.get("deadline"), deadline_cell)
    expires_at = deadline or (_kst(start.year, start.month, start.day) if start else None)

    if start and end:
        period = f"{start.isoformat()} ~ {end.isoformat()}"
    else:
        period = f.get("period", "")
    deadline_text = f.get("deadline") or (deadline_cell if deadline else "")

    sections: list[tuple[str, list[tuple[str, str, bool]]]] = [
        ("하는 일", [("직무명", f.get("job", ""), True), ("직무개요", f.get("overview", ""), False),
                  ("교육목표", f.get("goal", ""), False), ("운영/지도계획", f.get("plan", ""), False)]),
        ("지원 자격", [("선발대상", _targets(f.get("targets", "")), False), ("총 모집인원", "" if re.fullmatch(r"0\s*명", f.get("headcount", "")) else f.get("headcount", ""), False),
                   ("요구역량", f.get("skills", ""), False), ("기타사항", f.get("etc", ""), False)]),
        ("실습 조건", [("실습기간", period, False), ("정규 실습시간", f.get("hours", ""), False),
                   ("실습요일", f.get("days", ""), False), ("실습지원비(정규)", _money(f.get("pay", "")), False),
                   ("실습지원비(연장)", _money(f.get("pay_extra", "")), False), ("지급예정일", f.get("pay_day", ""), False),
                   ("근로계약", f.get("contract", ""), False), ("연장실습", f.get("extended", ""), False),
                   ("기타지원사항", f.get("support", ""), False)]),
        ("일정", [("접수마감", deadline_text, False), ("전형방법", f.get("method", ""), False),
                ("면접일자", f.get("interview", ""), False), ("최종선발일자", f.get("final", ""), False),
                ("참고일정", f.get("schedule", ""), False)]),
        ("학교 안내", [("학교 안내사항", f.get("school_note", ""), False)]),
        ("기관", [("기관명", org, False), ("부서", dept, False), ("구분", category, False),
                ("산업체분류", industry, False), ("소재지", place, False)]),
    ]
    body, body_html = _build_body(sections)
    return CoopNotice(
        id=f"{SOURCE_ID}/{jid}", article_no=jid, title=_title(org, f.get("job", "").split("\n")[0], dept, jid),
        category=category or None, deadline=deadline, expires_at=expires_at,
        practice_start=start, practice_end=end, body=body, body_html=body_html, dept=dept,
    )


def parse_export(data: dict, imported_at: datetime) -> list[CoopNotice]:
    """수집 JSON 전체를 읽어 jidSeq당 한 건으로 만든다(회차가 겹치면 먼저 나온 것을 쓴다)."""
    found: dict[str, CoopNotice] = {}
    for round_ in data.get("rounds") or []:
        for row in round_.get("rows") or []:
            notice = parse_row(row, imported_at)
            if notice and notice.id not in found:
                found[notice.id] = notice
    # 같은 기관이 부서마다 같은 직무명으로 올리면 제목이 겹쳐 목록에서 구분되지 않는다. 겹칠 때만 부서를 붙인다.
    counts = Counter(n.title for n in found.values())
    return [replace(n, title=f"{n.title} ({n.dept})") if counts[n.title] > 1 and n.dept else n for n in found.values()]
