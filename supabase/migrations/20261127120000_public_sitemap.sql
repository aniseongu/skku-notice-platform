-- 검색엔진용 공개 주소와 실제 콘텐츠 수정일만. 사용자 데이터와 공지 목록 본문은 공개하지 않는다.
-- 현장실습을 포함한 모든 종류(2026-11-27 사용자 지시). 단건 공개와 같은 만료 기준.
create or replace function public.get_public_sitemap(p_page integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_page is null or p_page < 0 or p_page >= 50000 then
    raise exception 'invalid sitemap page' using errcode = '22023';
  end if;
  with eligible as materialized (
    select n.id, coalesce(n.changed_at::text, n.posted_on::text) as lastmod
      from public.platform_notices n
      join public.platform_sources s on s.id = n.source_id
     where (n.expires_at is null or n.expires_at >= now())
  ), page as (
    select id, lastmod from eligible order by id limit 1000 offset (p_page::bigint * 1000)
  )
  select jsonb_build_object(
    'pages', greatest(1, ceil((select count(*) from eligible) / 1000.0)::integer),
    'notices', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'lastmod', lastmod) order by id) from page), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_public_sitemap(integer) from public, anon, authenticated;
grant execute on function public.get_public_sitemap(integer) to anon, authenticated, service_role;

-- RSSには最新50件の公開見出しだけ。本文・ユーザー作成文・ユーザー列は含めない。
create or replace function public.get_public_notice_feed()
returns table (id text, title text, source_name text, posted_on date, changed_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select n.id, n.title, s.name, n.posted_on, n.changed_at
    from public.platform_notices n join public.platform_sources s on s.id = n.source_id
   where n.expires_at is null or n.expires_at >= now()
   order by coalesce(n.changed_at, n.posted_on::timestamptz) desc, n.id
   limit 50;
$$;
revoke all on function public.get_public_notice_feed() from public, anon, authenticated;
grant execute on function public.get_public_notice_feed() to anon, authenticated, service_role;
