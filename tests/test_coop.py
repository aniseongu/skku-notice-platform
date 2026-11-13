# ruff: noqa: E501  (한국어 표 이름과 SQL은 한 줄에 한 항목이라 줄이 길다)
import importlib.util
import json
import sys
from datetime import datetime
from pathlib import Path

from skku_notice.coop import KST, parse_export, parse_row

NOW = datetime(2026, 11, 13, 12, 0, tzinfo=KST)


def _detail(**v):
    def tr(name, value):
        return f'<tr><th class="left_no">{name}</th><td colspan="3">{value}</td></tr>'
    days = "".join(
        f'<input type="checkbox" id="d{i}" {"checked=\'checked\'" if i < 5 else ""} disabled/><label for="d{i}">{x}</label>'
        for i, x in enumerate("월화수목금토일"))
    rows = [
        tr("학교 안내사항", v.get("school", "-")), tr("정규 실습시간", "09:00 ~ 18:00"),
        tr("실습기간", v.get("period", "2027-01-01 ~ 2027-02-28")), tr("실습요일", days),
        tr("접수마감일자", v.get("deadline", "2026-11-27 00:00")),
        tr("면접일자", '<input type="checkbox" id="m" checked disabled/><label for="m">일정별도 협의</label>'),
        tr("선발대상/학생평가교수", "<div>[전체학과 / 2 명 / 무관] / 평가교수 : </div><div>[전체학과 / 2 명 / 무관] / 평가교수 : </div>"),
        tr("학생요건 기타사항", v.get("etc", "<p>첫 줄\n* 항목 하나\n* 항목 둘\n둘째 문단</p>")),
        tr("실습지원비<br/>(정규실습시간)", "월&nbsp;2,000,000 원"), tr("기타지원사항", "\n -"),
        tr("직무명", v.get("job", "데이터 분석")), tr("직무개요", v.get("overview", "<p>업무 개요</p>")),
        tr("교육목표", "-"),
    ]
    return f'<table><tbody><tr><th colspan="2">실습직무</th></tr>{"".join(rows)}</tbody></table>'


def _row(jid="1001", **kw):
    cells = ["제조업", "중견기업", f'<a onclick="x(\'{jid}\')"> 테스트기업 주식회사</a>', "개발팀", "서울&nbsp;종로구",
             "27.01.01~27.02.28", kw.pop("cell_deadline", "2026-11-27 00:00"), "", "", ""]
    return {"jidSeq": jid, "cells": cells, "detail": _detail(**kw)}


def test_row_fields_and_body_structure():
    n = parse_row(_row(), NOW)
    assert n.id == "skku-coop/1001" and n.article_no == "1001" and n.category == "중견기업"
    assert n.title == "테스트기업 주식회사 · 데이터 분석"
    assert n.deadline == datetime(2026, 11, 27, 0, 0, tzinfo=KST) == n.expires_at
    assert (n.practice_start.isoformat(), n.practice_end.isoformat()) == ("2027-01-01", "2027-02-28")
    heads = [line for line in n.body.split("\n") if line in {"하는 일", "지원 자격", "실습 조건", "일정", "기관"}]
    assert heads == ["하는 일", "지원 자격", "실습 조건", "일정", "기관"]
    assert "학교 안내" not in n.body          # "-"만 있는 칸은 구역째 빠진다
    assert "교육목표" not in n.body and "기타지원사항" not in n.body
    assert "선발대상: 전체학과 2명 (학년 무관)" in n.body and n.body.count("전체학과") == 1
    assert "실습요일: 월~금" in n.body and "월 2,000,000원" in n.body
    assert "면접일자: 일정별도 협의" in n.body
    assert n.body_html.index("<h3>하는 일</h3>") < n.body_html.index("<h3>지원 자격</h3>") < n.body_html.index("<h3>기관</h3>")
    assert "<p><strong>데이터 분석</strong></p>" in n.body_html
    assert "<ul><li>항목 하나</li><li>항목 둘</li></ul>" in n.body_html
    assert "<p>첫 줄</p>" in n.body_html and "<p>둘째 문단</p>" in n.body_html
    assert "<input" not in n.body_html and "<div" not in n.body_html


def test_newlines_become_br_and_text_is_escaped():
    n = parse_row(_row(overview="<p>한 줄\n두 줄 &lt;script&gt;alert(1)&lt;/script&gt; &amp; 끝</p>"), NOW)
    assert "한 줄<br>두 줄" in n.body_html
    assert "<script>" not in n.body_html and "&lt;script&gt;" in n.body_html and "&amp;" in n.body_html
    assert "<script>" in n.body                      # 본문 글자는 원문 그대로


def test_real_script_tags_and_event_attributes_never_reach_html():
    n = parse_row(_row(etc='<p onclick="x()">안녕</p><script>alert(1)</script><img src=x onerror=1>'), NOW)
    assert "script" not in n.body_html and "onclick" not in n.body_html and "<img" not in n.body_html


def test_deadline_and_expiry_rules():
    assert parse_row(_row(deadline="2026-11-27", cell_deadline=""), NOW).deadline == datetime(2026, 11, 27, 23, 59, tzinfo=KST)
    n = parse_row(_row(deadline="-", cell_deadline="-"), NOW)       # 마감이 없으면 실습 시작일 0시가 만료 시각
    assert n.deadline is None and n.expires_at == datetime(2027, 1, 1, tzinfo=KST)
    n = parse_row(_row(deadline="일정별도 협의", cell_deadline="", period="-"), NOW)   # 기간은 목록 칸을 쓴다
    assert n.deadline is None and n.practice_start.isoformat() == "2027-01-01"
    row = _row(deadline="-", cell_deadline="-")
    row["cells"][5] = "-"
    row["detail"] = row["detail"].replace("2027-01-01 ~ 2027-02-28", "-")
    assert parse_row(row, NOW).expires_at is None


def test_title_fallbacks_and_bad_ids():
    assert parse_row(_row(job="-"), NOW).title == "테스트기업 주식회사 · 개발팀"
    row = _row()
    row["cells"][2] = ""
    row["cells"][3] = ""
    assert parse_row({**row, "detail": _detail(job="-")}, NOW).title == "현장실습 1001"
    assert parse_row({**_row(), "jidSeq": "12a"}, NOW) is None
    assert parse_row({**_row(), "jidSeq": "1; drop table x"}, NOW) is None


def test_export_dedupes_ids_and_ignores_unknown_cells():
    row = _row()
    row["cells"].append("개인 신청 상태 비밀")
    data = {"rounds": [{"rows": [row, _row()]}, {"rows": [_row("1002")]}]}
    notices = parse_export(data, NOW)
    assert [n.id for n in notices] == ["skku-coop/1001", "skku-coop/1002"]
    assert all("비밀" not in n.body for n in notices)


def _import_module():
    spec = importlib.util.spec_from_file_location("coop_import", Path(__file__).parent.parent / "scripts" / "coop_import.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["coop_import"] = module
    spec.loader.exec_module(module)
    return module


def test_sql_upsert_keeps_first_seen_skips_expired_and_guards_empty():
    mod = _import_module()
    data = {"rounds": [{"rows": [_row("1001"), _row("1002", deadline="2026-01-01 00:00", cell_deadline="2026-01-01 00:00")]}]}
    notices = parse_export(data, NOW)
    sql = mod.build_sql(notices, NOW, tag="ctest")
    update = sql.split("on conflict (id) do update set")[1].split(";")[0]
    assert "first_seen" not in update and "posted_on" not in update and "body_html = excluded.body_html" in update
    assert "$ctest$skku-coop/1001$ctest$" in sql and "1002" not in sql          # 지난 공고는 빠진다
    assert "begin;" in sql and sql.rstrip().endswith("commit;")
    assert "id <> all (array[" in sql and "and exists (select 1 from public.platform_notices where id = any" in sql
    assert mod.build_sql([], NOW).startswith("--") and "delete" not in mod.build_sql([], NOW)
    expired_only = parse_export({"rounds": [{"rows": [_row("1002", deadline="2026-01-01 00:00", cell_deadline="x")]}]}, NOW)
    assert "delete" not in mod.build_sql(expired_only, NOW)


def test_sql_quoting_blocks_tag_collision():
    mod = _import_module()
    try:
        mod._quote("a $t$ b", "t")
    except ValueError:
        pass
    else:
        raise AssertionError("collision not detected")
    assert mod._quote("it's $x", "t") == "$t$it's $x$t$"
    json.dumps({})


def test_same_titles_get_department_only_when_they_collide():
    a, b, c = _row("1001"), _row("1002"), _row("1003", job="다른 직무")
    b["cells"][3] = "기획팀"
    titles = {n.id: n.title for n in parse_export({"rounds": [{"rows": [a, b, c]}]}, NOW)}
    assert titles == {
        "skku-coop/1001": "테스트기업 주식회사 · 데이터 분석 (개발팀)",
        "skku-coop/1002": "테스트기업 주식회사 · 데이터 분석 (기획팀)",
        "skku-coop/1003": "테스트기업 주식회사 · 다른 직무",
    }
