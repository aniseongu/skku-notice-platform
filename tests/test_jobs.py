from datetime import datetime
from pathlib import Path

import pytest

from skku_notice import fetch, jobs
from skku_notice.archive import Archive, add_notice, set_source_deadlines
from skku_notice.deadline import KST
from skku_notice.export import _public_notice

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=KST)


def test_linkareer_open_internships_with_deadline():
    calls = []

    def post(url, body, headers):
        calls.append((url, body["variables"]["p"]))
        return {"data": {"activities": {"nodes": [
            {"id": "361803", "title": "AI콘텐츠 인턴 (정규전환형)", "organizationName": "콘레브",
             "recruitStartAt": 1793631600000, "recruitCloseAt": 1801493999999,
             "distinctInternTypes": [{"name": "채용연계형 인턴"}, {"name": "기타"}]},
            {"id": "1", "title": "지난 공고", "organizationName": "A", "recruitCloseAt": 1700000000000},
        ]}}}

    postings = jobs.linkareer(post, NOW, "linkareer-intern")
    assert calls == [(jobs.LK_API, {"page": 1, "pageSize": jobs.LIMIT})]
    assert len(postings) == 1
    notice, deadline = postings[0]
    assert notice.source_id == "linkareer-intern" and notice.title == "[콘레브] AI콘텐츠 인턴 (정규전환형)"
    assert notice.category == "채용연계형 인턴" and notice.url == "https://linkareer.com/activity/361803"
    assert deadline.startswith("2027-")


def test_jasoseol_keeps_open_interns_newest_first():
    def post(url, body, headers):
        assert url == jobs.JSS_CAL and "start_time" in body
        return {"employment": [
            {"id": 1, "name": "모두닥", "title": "채용전환형 인턴", "employments": [{"division": 3}],
             "start_time": "2026-10-28T00:00:00.000+09:00", "end_time": "2026-11-20T23:59:00.000+09:00"},
            {"id": 2, "name": "B", "title": "신입 공채", "employments": [{"division": 1}],
             "start_time": "2026-10-30T00:00:00.000+09:00", "end_time": "2026-11-20T23:59:00.000+09:00"},
            {"id": 3, "name": "C", "title": "겨울 인턴", "employments": [],
             "start_time": "2026-10-31T00:00:00.000+09:00", "end_time": "2026-11-01T23:59:00.000+09:00"},
        ]}

    postings = jobs.jasoseol(post, NOW, "jasoseol-intern")
    assert [n.article_no for n, _ in postings] == ["1"]
    assert postings[0][0].title == "[모두닥] 채용전환형 인턴"
    assert postings[0][1] == "2026-11-20T23:59:00+09:00"


def test_external_deadline_reaches_public_notice():
    notice = jobs.jasoseol(lambda *a: {"employment": [
        {"id": 9, "name": "X", "title": "인턴", "employments": [{"division": 3}],
         "start_time": "2026-11-01T00:00:00.000+09:00",
         "end_time": "2026-11-25T18:00:00.000+09:00"}]}, NOW)[0][0]
    archive = add_notice(Archive(), notice, NOW.isoformat())
    archive = set_source_deadlines(archive, {"jasoseol/9": "2026-11-25T18:00:00+09:00"})
    public = _public_notice(archive.items["jasoseol/9"])
    assert public["deadline"] == "2026-11-25T18:00:00+09:00" and public["deadline_kind"] == "마감"


@pytest.mark.parametrize("url", ["http://jasoseol.com/x", "https://evil.example/graphql", "https://jasoseol.com:8443/x"])
def test_external_fetch_only_allows_the_two_apis(url):
    with pytest.raises(fetch.UnsafeURL):
        fetch.fetch_json_post(url, {}, "ua", 1)


def test_outside_ids_must_be_plain_numbers():
    def post(url, body, headers):
        return {"data": {"activities": {"nodes": [
            {"id": "../../index", "title": "인턴", "recruitCloseAt": 1801493999999},
            {"id": "12 34", "title": "인턴", "recruitCloseAt": 1801493999999},
            {"id": "777", "title": "인턴", "recruitCloseAt": 1801493999999},
        ]}}}

    assert [n.article_no for n, _ in jobs.linkareer(post, NOW)] == ["777"]


def test_keyword_alone_does_not_make_external_posting_mine():
    from skku_notice.interests import is_mine

    keyword_only = {"rule_name": None, "interests": ["인턴"], "ai": None}
    assert is_mine(keyword_only) and not is_mine(keyword_only, external=True)
    assert is_mine({"ai": {"verdict": "relevant"}, "interests": []}, external=True)


def test_public_job_details_keep_text_and_image():
    from pathlib import Path

    fixtures = Path(__file__).parent / "fixtures"
    linkareer = jobs.parse_job_detail((fixtures / "linkareer_view_public.html").read_text(),
                                      "linkareer", "361618", "https://linkareer.com/activity/361618")
    jasoseol = jobs.parse_job_detail((fixtures / "jasoseol_view_public.html").read_text(),
                                     "jasoseol", "107002", "https://jasoseol.com/recruit/107002")
    assert len(linkareer.body_text) > 100 and "<p" in linkareer.body_html
    assert jasoseol.images and "<img" in jasoseol.body_html
    assert not jasoseol.body_text
    with pytest.raises(jobs.ParseError):
        jobs.parse_job_detail((fixtures / "jasoseol_view_public.html").read_text(),
                              "jasoseol", "999", "https://jasoseol.com/recruit/999")


def test_job_detail_rejects_unsafe_markup_and_empty_data():
    import json

    page = {"props": {"pageProps": {"initialEmploymentCompany": {
        "id": 7, "content": ('<p onclick="evil()">본문<script>evil()</script></p>'
                             '<a href="javascript:evil()">링크</a>')
    }}}}
    payload = json.dumps(page).replace("</", "<\\/")
    html = '<script id="__NEXT_DATA__" type="application/json">' + payload + "</script>"
    detail = jobs.parse_job_detail(html, "jasoseol", "7", "https://jasoseol.com/recruit/7")
    assert "본문" in detail.body_text
    assert not any(word in detail.body_html for word in ("onclick", "javascript:", "<script"))
    with pytest.raises(jobs.ParseError):
        jobs.parse_job_detail('<script id="__NEXT_DATA__">{}</script>', "jasoseol", "7", "https://jasoseol.com/recruit/7")


def test_external_detail_backfills_once_and_exports(tmp_path, monkeypatch):
    from pathlib import Path
    from types import SimpleNamespace

    from skku_notice import cli
    from skku_notice.export import export_site

    notice = jobs.jasoseol(lambda *a: {"employment": [{
        "id": 107002, "name": "회사", "title": "인턴", "employments": [{"division": 3}],
        "start_time": "2026-11-01T00:00:00+09:00", "end_time": "2026-11-25T18:00:00+09:00",
    }]}, NOW, "jasoseol-intern")[0][0]
    state = SimpleNamespace(sources={"jasoseol-intern": SimpleNamespace(seen={})})
    source = {"id": "jasoseol-intern", "kind": "jasoseol", "external": True, "name": "자소설닷컴", "url": "https://jasoseol.com/recruit"}
    html = (Path(__file__).parent / "fixtures/jasoseol_view_public.html").read_text()
    calls = []
    monkeypatch.setattr(cli, "ARCHIVE_PATH", tmp_path / "archive.json")
    monkeypatch.setattr(cli.time, "sleep", lambda _: None)
    monkeypatch.setattr(cli, "fetch_detail", lambda *args: calls.append(args[0]) or html)
    settings = {"user_agent": "test", "timeout_seconds": 10}
    archive = cli._fill_details(Archive(), state, [(source, [notice])], settings, False, NOW)
    archive = cli._fill_details(archive, state, [(source, [notice])], settings, False, NOW)
    assert len(calls) == 1
    assert archive.items["jasoseol-intern/107002"]["images"]
    export_site(tmp_path / "site", archive, [source], NOW, web_path=tmp_path / "missing")
    import json
    detail = json.loads((tmp_path / "site/api/v1/notices/jasoseol-intern/107002.json").read_text())
    assert detail["images"] and "<img" in detail["body_html"]


def test_linkareer_detail_reuses_public_graphql_query(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from skku_notice import cli

    notice = jobs.linkareer(lambda *a: {"data": {"activities": {"nodes": [{
        "id": "361618", "title": "인턴", "recruitCloseAt": 1801493999999,
    }]}}}, NOW, "linkareer-intern")[0][0]
    calls = []
    data = {"data": {"activity": {"id": "361618", "detailText": {"text": "<p>지원 방법 본문</p>"}}}}
    monkeypatch.setattr(cli, "ARCHIVE_PATH", tmp_path / "archive.json")
    monkeypatch.setattr(cli.time, "sleep", lambda _: None)
    monkeypatch.setattr(cli, "fetch_json_post", lambda *args: calls.append(args) or data)
    monkeypatch.setattr(cli, "fetch_detail", lambda *args: pytest.fail("링커리어는 본문 API를 쓴다"))
    source = {"id": "linkareer-intern", "kind": "linkareer", "external": True}
    state = SimpleNamespace(sources={source["id"]: SimpleNamespace(seen={})})
    archive = cli._fill_details(Archive(), state, [(source, [notice])],
                                {"user_agent": "test", "timeout_seconds": 10}, False, NOW)
    assert calls[0][0] == jobs.LK_API
    assert calls[0][1] == {"query": jobs.LK_DETAIL, "variables": {"id": "361618"}}
    assert "지원 방법" in archive.items["linkareer-intern/361618"]["body_text"]
    with pytest.raises(jobs.ParseError):
        jobs.parse_linkareer_detail(data, "999", "https://linkareer.com/activity/999")


def test_external_api_malformed_json_is_a_recoverable_fetch_error(monkeypatch):
    import httpx

    real_client = httpx.Client
    monkeypatch.setattr(fetch, "_resolve_addresses", lambda _: {"8.8.8.8"})
    monkeypatch.setattr(fetch.httpx, "Client", lambda **kwargs: real_client(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, text="BROKEN_RESPONSE"))))
    with pytest.raises(fetch.FetchError) as caught:
        fetch.fetch_json_post(jobs.LK_API, {}, "ua", 1)
    assert "BROKEN_RESPONSE" not in str(caught.value)


def test_public_intern_reason_does_not_promote_other_majors(tmp_path):
    import json

    from skku_notice.export import export_site
    from skku_notice.judge import Judgment

    notice = jobs.linkareer(lambda *a: {"data": {"activities": {"nodes": [{
        "id": "361578", "title": "인턴", "recruitCloseAt": 1801493999999,
    }]}}}, NOW, "linkareer-intern")[0][0]
    archive = add_notice(Archive(), notice, NOW.isoformat(), judgment=Judgment(
        "relevant", "수학, 통계 전공자를 우대하며 VBA를 활용해요", "test"))
    source = {"id": "linkareer-intern", "name": "링커리어", "url": "https://linkareer.com", "external": True}
    export_site(tmp_path, archive, [source], NOW, web_path=tmp_path / "missing")
    items = json.loads((tmp_path / "api/v1/matched.json").read_text())["items"]
    decision = items[notice.source_id + "/" + notice.article_no]["ai"]
    assert decision["reason"] == "담당 업무와 지원 자격을 원문에서 확인해 주세요"
    assert decision["verdict"] == "maybe"


@pytest.mark.parametrize('collector,response', [
    (jobs.linkareer, {'errors': [{'message': 'temporary'}]}),
    (jobs.linkareer, {'data': {'activities': {}}}),
    (jobs.jasoseol, {}),
    (jobs.jasoseol, {'employment': None}),
])
def test_external_invalid_response_is_not_success(collector, response):
    with pytest.raises((KeyError, ValueError)):
        collector(lambda *args: response, NOW)


def test_skku_career_public_list_and_detail():
    fixtures = Path(__file__).parent / 'fixtures'
    html = (fixtures / 'skku_career_intern_list_2026-11-06.html').read_text()
    postings = jobs.skku_career_list(html, NOW, 'skku-career-intern')
    assert len(postings) == 20
    first, deadline = postings[0]
    assert first.article_no == '165070' and '딜로이트' in first.title
    assert first.url.startswith('https://job.skku.edu/Recruit/RecruitView.aspx?rcdx=')
    assert deadline == '2026-11-19T23:59:00+09:00'
    assert postings[2][1] is None
    detail_html = (fixtures / 'skku_career_intern_view_165070_2026-11-06.html').read_text()
    detail = jobs.parse_job_detail(detail_html, 'skku-career-intern', first.article_no, first.url)
    assert '인턴 채용' in detail.body_text
    assert not detail.images
    assert len(detail.attachments) == 2
    assert detail.attachments[0][1].startswith('https://job.skku.edu/upload/Recruit/')
    assert detail.attachments[0][2] == 'DOCX'
    with pytest.raises(jobs.ParseError):
        jobs.skku_career_list('<html></html>', NOW, 'skku-career-intern')


def test_skku_career_details_flow_to_intern_judgment_and_export(tmp_path, monkeypatch):
    import json
    from types import SimpleNamespace

    from skku_notice import cli
    from skku_notice.export import export_site
    from skku_notice.judge import Judgment
    from skku_notice.notification_policy import alert_priority

    fixtures = Path(__file__).parent / 'fixtures'
    notice = jobs.skku_career_list(
        (fixtures / 'skku_career_intern_list_2026-11-06.html').read_text(), NOW, 'skku-career-intern'
    )[0][0]
    source = {'id': notice.source_id, 'name': '성대 학생인재개발팀', 'kind': 'skku-career-intern',
              'external': True, 'url': 'https://job.skku.edu/Recruit/RecruitInternList.aspx?rp=1'}
    state = SimpleNamespace(sources={source['id']: SimpleNamespace(seen={})})
    monkeypatch.setattr(cli, 'ARCHIVE_PATH', tmp_path / 'archive.json')
    monkeypatch.setattr(cli.time, 'sleep', lambda _: None)
    html = (fixtures / 'skku_career_intern_view_165070_2026-11-06.html').read_text()
    monkeypatch.setattr(cli, 'fetch_detail', lambda *args: html)
    received = []
    def judge(items, *args, **kwargs):
        received.extend(items)
        return {items[0]['id']: Judgment('relevant', '개발 직무예요', 'model')}
    monkeypatch.setattr(cli, 'judge_internships', judge)
    archive = cli._fill_details(Archive(), state, [(source, [notice])],
                                {'user_agent': 'test', 'timeout_seconds': 10}, False, NOW)
    archive, judgments = cli._intern_decisions(
        archive, state, [source], {'model': 'model'}, 'fake', [10], 'test')
    key = f'{source["id"]}/{notice.article_no}'
    assert received[0]['id'] == key and '인턴 채용' in received[0]['body']
    assert alert_priority(external=True, title=notice.title, body=received[0]['body'], match=None,
                          judgment=judgments[key], interests=()) == 'default'
    export_site(tmp_path / 'site', archive, [source], NOW, web_path=tmp_path / 'missing')
    listing = json.loads((tmp_path / 'site/api/v1/notices.json').read_text())
    detail = json.loads((tmp_path / f'site/api/v1/notices/{key}.json').read_text())
    assert listing['sources'][0]['external'] is True and listing['notices'][0]['url'] == notice.url
    assert len(detail['attachments']) == 2 and not detail['images']
