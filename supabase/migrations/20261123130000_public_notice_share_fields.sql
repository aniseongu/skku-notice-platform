-- 공개 단건 공유의 첨부와 현장실습 표시. 직접 표 접근과 단건 만료 규칙은 그대로 둔다.
-- 반환 형식 변경은 PostgreSQL에서 DROP/CREATE가 필요하다. migration 트랜잭션 안에서 권한까지 복원한다.
drop function if exists public.get_public_notice(text);

create function public.get_public_notice(p_id text)
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
  body_html text,
  attachments jsonb,
  coop boolean
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
           n.posted_on, n.deadline, n.body, n.body_html,
           coalesce((
             select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'name', file.value ->> 'name', 'url', file.value ->> 'url',
               'type', file.value ->> 'type', 'size', file.value ->> 'size'
             )) order by file.position)
               from jsonb_array_elements(n.attachments) with ordinality as file(value, position)
              where jsonb_typeof(file.value -> 'name') = 'string'
                and jsonb_typeof(file.value -> 'url') = 'string'
                and file.value ->> 'url' ~* '^https?://'
           ), '[]'::jsonb), s.coop
      from public.platform_notices n
      join public.platform_sources s on s.id = n.source_id
     where n.id = p_id
       and (n.expires_at is null or n.expires_at >= now());
end;
$$;

revoke all on function public.get_public_notice(text) from public;
grant execute on function public.get_public_notice(text) to anon, authenticated, service_role;
