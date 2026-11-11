from datetime import datetime
from pathlib import Path

import pytest

from skku_notice import fetch, jobs
from skku_notice.deadline import KST

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






def test_external_api_malformed_json_is_a_recoverable_fetch_error(monkeypatch):
    import httpx

    real_client = httpx.Client
    monkeypatch.setattr(fetch, "_resolve_addresses", lambda _: {"8.8.8.8"})
    monkeypatch.setattr(fetch.httpx, "Client", lambda **kwargs: real_client(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, text="BROKEN_RESPONSE"))))
    with pytest.raises(fetch.FetchError) as caught:
        fetch.fetch_json_post(jobs.LK_API, {}, "ua", 1)
    assert "BROKEN_RESPONSE" not in str(caught.value)




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


