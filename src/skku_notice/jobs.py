# 출처: https://github.com/hg111911190-sketch/skku-notice/blob/main/jobs.py
"""External internship postings and public details (D-028)."""

import json
import re
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from urllib.parse import unquote, urljoin, urlsplit

from selectolax.lexbor import LexborHTMLParser

from skku_notice.deadline import KST
from skku_notice.model import Notice
from skku_notice.parse import Detail, ParseError, parse_external_fragment

LIMIT = 30
LK_API = "https://api.linkareer.com/graphql"
LK_HEADERS = {"Origin": "https://linkareer.com", "Referer": "https://linkareer.com/"}
LK_LIST = (
    "query($f:ActivityFilter,$o:ActivityOrder,$p:Pagination)"
    "{activities(filterBy:$f,orderBy:$o,pagination:$p)"
    "{nodes{id title organizationName recruitStartAt recruitCloseAt"
    " categories{name} distinctInternTypes{name}}}}"
)
# 출처: https://github.com/hg111911190-sketch/skku-notice/blob/main/jobs.py (linkareer_detail)
LK_DETAIL = "query($id:ID!){activity(id:$id){id detailText{text}}}"
JSS_CAL = "https://jasoseol.com/employment/calendar_list.json"

Post = Callable[[str, dict, dict], dict]
Posting = tuple[Notice, str | None]


def _number(value: object) -> str | None:
    """Article number from an outside site. Only plain digits, so it is safe in file paths and URLs."""
    text = str(value)
    return text if text.isdigit() and len(text) <= 20 else None


def _from_ms(value: object) -> datetime | None:
    return datetime.fromtimestamp(value / 1000, KST) if isinstance(value, int | float) and value > 0 else None


def linkareer(post: Post, now: datetime, source_id: str = "linkareer") -> list[Posting]:
    variables = {"f": {"activityTypeID": "5", "jobTypes": ["INTERN"], "status": "OPEN"},
                 "o": {"direction": "DESC", "field": "RECENT"}, "p": {"page": 1, "pageSize": LIMIT}}
    response = post(LK_API, {"query": LK_LIST, "variables": variables}, LK_HEADERS)
    if response.get("errors"):
        raise ValueError("linkareer API error")
    nodes = response["data"]["activities"]["nodes"]
    if not isinstance(nodes, list):
        raise ValueError("invalid linkareer list")
    postings = []
    for node in nodes:
        close, start = _from_ms(node.get("recruitCloseAt")), _from_ms(node.get("recruitStartAt"))
        number = _number(node.get("id"))
        if not number or not node.get("title") or (close and close < now):
            continue
        types = node.get("distinctInternTypes") or []
        kinds = [t["name"] for t in types if t.get("name") and t["name"] != "기타"]
        company = node.get("organizationName") or ""
        title = f"[{company}] {node['title']}" if company and company not in node["title"] else node["title"]
        postings.append((Notice(source_id, number, title, ", ".join(kinds) or "인턴",
                                f"https://linkareer.com/activity/{number}", (start or now).date(), False),
                         close.isoformat() if close else None))
    return postings


def jasoseol(post: Post, now: datetime, source_id: str = "jasoseol") -> list[Posting]:
    def iso(moment: datetime) -> str:
        return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    window = {"start_time": iso(now - timedelta(days=30)), "end_time": iso(now + timedelta(days=90))}
    data = post(JSS_CAL, window, {})
    employment = data["employment"]
    if not isinstance(employment, list):
        raise ValueError("invalid jasoseol list")
    chosen = {}
    for item in employment:
        divisions = {part.get("division") for part in item.get("employments") or []}
        title = item.get("title") or ""
        end = datetime.fromisoformat(item["end_time"]).astimezone(KST) if item.get("end_time") else None
        # division 3이 인턴이다(참고 코드). 제목에 인턴이 있는 공고도 받는다.
        number = _number(item.get("id"))
        if not number or (3 not in divisions and "인턴" not in title) or (end and end < now):
            continue
        chosen[number] = (item, end, number)
    newest = sorted(chosen.values(), key=lambda entry: entry[0].get("start_time") or "", reverse=True)[:LIMIT]
    postings = []
    for item, end, number in newest:
        start = datetime.fromisoformat(item["start_time"]).astimezone(KST) if item.get("start_time") else now
        company = item.get("name") or ""
        title = f"[{company}] {item['title']}" if company and company not in item["title"] else item["title"]
        postings.append((Notice(source_id, number, title, "인턴",
                                f"https://jasoseol.com/recruit/{number}", start.date(), False),
                         end.isoformat() if end else None))
    return postings


COLLECTORS = {"linkareer": linkareer, "jasoseol": jasoseol}


def skku_career_list(html: str, now: datetime, source_id: str) -> list[Posting]:
    rows = LexborHTMLParser(html).css('tr[id^="hcTr"]')
    postings = []
    for row in rows:
        link = row.css_first('a[href^="javascript:detailView("]')
        if not link:
            continue
        match = re.fullmatch(r"javascript:detailView\('([A-Za-z0-9]+)',\s*'(\d+)'\);?",
                             link.attributes['href'])
        cells = row.css('td')
        if not match or len(cells) < 4 or not link.text(strip=True):
            raise ParseError("invalid career internship row")
        posted_text = cells[0].text(strip=True)
        try:
            posted = (now.date() if posted_text == 'TODAY'
                      else datetime.strptime(posted_text, '%Y-%m-%d').date())
            deadline_text = cells[3].text(strip=True)
            deadline = None
            if re.fullmatch(r'\d{2}-\d{2}-\d{2}', deadline_text):
                deadline = datetime.strptime(deadline_text, '%y-%m-%d').replace(
                    hour=23, minute=59, tzinfo=KST).isoformat()
        except ValueError as exc:
            raise ParseError("invalid career internship date") from exc
        token, number = match.groups()
        url = f'https://job.skku.edu/Recruit/RecruitView.aspx?rcdx={token}&modalChk=Y'
        notice = Notice(source_id, number, link.text(strip=True), '인턴', url, posted, False)
        postings.append((notice, deadline))
    if not postings:
        raise ParseError('career internship list empty')
    return postings


def parse_job_detail(html: str, kind: str, article_no: str, url: str) -> Detail:
    """Read the matching public posting from Next.js data, then sanitize its HTML."""
    if _number(article_no) != article_no:
        raise ParseError("invalid external article number")
    if kind == 'skku-career-intern':
        body = LexborHTMLParser(html).css_first('#ALLTEXT')
        if body is None:
            raise ParseError('career internship body missing')
        attachments = []
        for link in body.css('a[href]'):
            target = urljoin(url, link.attributes['href'])
            parsed = urlsplit(target)
            name = link.text(separator=' ', strip=True)
            if (parsed.scheme == 'https' and parsed.hostname == 'job.skku.edu'
                    and unquote(parsed.path).startswith('/upload/Recruit/') and name):
                suffix = unquote(parsed.path).rsplit('.', 1)[-1].upper()
                attachments.append((name, target, suffix, None))
        for icon in body.css('img[src]'):
            path = urlsplit(urljoin(url, icon.attributes['src'])).path.lower()
            if path.startswith('/app/system/editor/filetype/'):
                icon.decompose()
        detail = parse_external_fragment(body.html, url)
        return Detail(detail.body_text, tuple(attachments), detail.images, detail.body_html)
    node = LexborHTMLParser(html).css_first("script#__NEXT_DATA__")
    try:
        page = json.loads(node.text())["props"]["pageProps"] if node else {}
        if kind == "linkareer":
            state = page["__APOLLO_STATE__"]
            ref = state[f"Activity:{article_no}"]["detailText"]["__ref"]
            if not isinstance(ref, str) or not ref.startswith("ActivityText:"):
                raise ValueError("invalid detail reference")
            markup = state[ref]["text"]
        elif kind == "jasoseol":
            posting = page["initialEmploymentCompany"]
            if str(posting["id"]) != article_no:
                raise ValueError("detail id mismatch")
            markup = posting["content"]
        else:
            raise ValueError("unknown external board")
        if not isinstance(markup, str):
            raise ValueError("invalid detail")
    except (KeyError, TypeError, ValueError) as exc:
        raise ParseError("external detail data missing or invalid") from exc
    return parse_external_fragment(markup, url)


def parse_linkareer_detail(data: dict, article_no: str, url: str) -> Detail:
    """Read the public GraphQL detail response used by the source project's scraper."""
    try:
        posting = data["data"]["activity"]
        if data.get("errors") or str(posting["id"]) != article_no:
            raise ValueError("detail id mismatch")
        markup = posting["detailText"]["text"]
        if not isinstance(markup, str):
            raise ValueError("invalid detail")
    except (KeyError, TypeError, ValueError) as exc:
        raise ParseError("linkareer detail data missing or invalid") from exc
    return parse_external_fragment(markup, url)
