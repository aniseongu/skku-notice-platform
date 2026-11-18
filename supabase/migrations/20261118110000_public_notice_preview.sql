-- 비로그인 공유 미리보기 (2026-11-18): 공지 한 건을 id로만 읽는 함수.
-- 표의 anon 접근은 그대로 막혀 있다(RLS·revoke 변경 없음). 목록·검색 함수는 만들지 않는다.
-- 공개 열만 돌려준다: 사용자별 판정·요약·저장·읽음·키 정보와 내부 열(해시, OCR 큐, dup 키 등)은 없다.
-- 없는 id, 만료된 공지, 현장실습(coop) 출처는 빈 결과. 입력은 200자 이하 '출처/숫자' 형식만 받는다. 멱등이다.

create or replace function public.get_public_notice(p_id text)
returns table (
  id text,
  source_id text,
  source_name text,
  external boolean,
  title text,
  category text,
  url text,
  posted_on date,
  deadline timestamptz,
  body text,
  body_html text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_id is null or length(p_id) > 200 or p_id !~ '^[a-z0-9-]+/[0-9]+$' then
    raise exception 'invalid notice id' using errcode = '22023';
  end if;
  return query
    select n.id, n.source_id, s.name, s.external, n.title, n.category, n.url,
           n.posted_on, n.deadline, n.body, n.body_html
      from public.platform_notices n
      join public.platform_sources s on s.id = n.source_id
     where n.id = p_id
       and not s.coop -- 현장실습은 학교 로그인 뒤 시스템에서 가져온 자료라 익명 미리보기에서 뺀다
       and (n.expires_at is null or n.expires_at >= now());
end;
$$;

revoke all on function public.get_public_notice(text) from public;
grant execute on function public.get_public_notice(text) to anon, authenticated, service_role;
