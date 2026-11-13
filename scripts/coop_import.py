# ruff: noqa: E501  (한국어 표 이름과 SQL은 한 줄에 한 항목이라 줄이 길다)
"""톨게이트 현장실습 수집 JSON을 운영 DB에 올린다.

사용: python scripts/coop_import.py <raw.json> [--sql-out 경로] [--apply]
  기본은 건수만 보여 주고 SQL 파일만 만든다(DB는 건드리지 않는다).
  --apply는 만든 SQL을 `supabase db query --remote=<ref> --yes -f`로 실행한다(--apply가 곧 운영 반영 확인이다).
JSON과 SQL에는 공고 내용이 들어 있으니 저장소 안에 두지 않는다(기본 경로는 임시 폴더).
"""

import argparse
import json
import secrets
import subprocess
import sys
import tempfile
from collections import Counter
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from skku_notice.coop import KST, SOURCE_ID, CoopNotice, parse_export  # noqa: E402

PROJECT_REF = "puspyfotjyxyhchbiudi"
COLUMNS = ("id, source_id, article_no, title, category, url, posted_on, first_seen, fetched_at, "
           "deadline, expires_at, body, body_html")


def _quote(value: str | None, tag: str) -> str:
    """문자열은 실행마다 새로 만든 달러 태그로 감싼다. 값 안에 태그가 있으면 멈춘다."""
    if value is None:
        return "null"
    if f"${tag}$" in value or value.endswith("$"):
        raise ValueError("dollar-quote tag collision")
    return f"${tag}${value}${tag}$"


def _ts(value: datetime | None) -> str:
    return f"'{value.isoformat()}'::timestamptz" if value else "null"


def build_sql(notices: list[CoopNotice], now: datetime, tag: str | None = None) -> str:
    """expires_at이 지난 공고는 빼고, 남은 것을 upsert한 뒤 이번에 없는 현장실습 공고를 지운다.
    이미 있는 행은 first_seen·posted_on을 바꾸지 않는다. 남은 공고가 0건이면 아무것도 하지 않는다."""
    tag = tag or f"c{secrets.token_hex(8)}"
    keep = [n for n in notices if n.expires_at is None or n.expires_at > now]
    if not keep:
        return "-- 올릴 공고가 없어 아무것도 하지 않는다.\n"
    for n in keep:
        if not n.article_no.isdigit():
            raise ValueError("jidSeq must be digits")
    stamp, today = _ts(now), now.astimezone(KST).date().isoformat()
    rows = ",\n".join(
        f"({_quote(n.id, tag)}, '{SOURCE_ID}', {_quote(n.article_no, tag)}, {_quote(n.title, tag)}, "
        f"{_quote(n.category, tag)}, {_quote(n.url, tag)}, '{today}'::date, {stamp}, {stamp}, "
        f"{_ts(n.deadline)}, {_ts(n.expires_at)}, {_quote(n.body, tag)}, {_quote(n.body_html, tag)})"
        for n in keep)
    ids = ", ".join(_quote(n.id, tag) for n in keep)
    return f"""begin;
do $check$ begin
  if not exists (select 1 from public.platform_sources where id = '{SOURCE_ID}' and coop) then
    raise exception 'skku-coop source is missing: apply the coop migration first';
  end if;
end $check$;
insert into public.platform_notices ({COLUMNS})
values
{rows}
on conflict (id) do update set
  title = excluded.title, category = excluded.category, url = excluded.url, fetched_at = excluded.fetched_at,
  deadline = excluded.deadline, expires_at = excluded.expires_at, body = excluded.body, body_html = excluded.body_html;
-- 이번 가져오기에 없는 현장실습 공고를 지운다(이번 행이 하나라도 DB에 있을 때만). 지운 번호는 기록하지 않는다.
delete from public.platform_notices
 where source_id = '{SOURCE_ID}' and id <> all (array[{ids}])
   and exists (select 1 from public.platform_notices where id = any (array[{ids}]));
commit;
"""


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("raw", type=Path)
    ap.add_argument("--sql-out", type=Path)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args(argv)

    now = datetime.now(KST).replace(microsecond=0)
    notices = parse_export(json.loads(args.raw.read_text(encoding="utf-8")), now)
    live = [n for n in notices if n.expires_at is None or n.expires_at > now]
    print(f"전체 {len(notices)}건, 올릴 것 {len(live)}건, 이미 지나서 건너뜀 {len(notices) - len(live)}건")
    print(f"접수마감 있음 {sum(1 for n in live if n.deadline)}건, 없음 {sum(1 for n in live if not n.deadline)}건")
    for name, count in Counter(n.category or "(없음)" for n in live).most_common():
        print(f"  {name}: {count}")

    out = args.sql_out or Path(tempfile.mkstemp(prefix="coop-import-", suffix=".sql")[1])
    out.write_text(build_sql(notices, now), encoding="utf-8")
    out.chmod(0o600)
    print(f"SQL: {out}")
    if not args.apply:
        print("(건수만 확인했어요. 올리려면 --apply)")
        return 0
    if not live:
        print("올릴 공고가 없어 실행하지 않아요.")
        return 1
    return subprocess.run(["supabase", "db", "query", f"--remote={PROJECT_REF}", "--yes", "-f", str(out)]).returncode


if __name__ == "__main__":
    raise SystemExit(main())
