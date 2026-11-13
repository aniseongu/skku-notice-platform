-- 추출 규칙을 바꿨을 때, 새 규칙이 겨냥하는 문구가 든 공고의 졸업요건 판정만 다시 대기로 돌린다.
-- 규칙 버전을 올리면 모든 판정이 다시 만들어져 사용자의 AI 키 한도를 쓰므로 이 함수를 대신 쓴다.
-- input_hash는 null을 허용하는 열이라 null로 비운다. 워커는 입력 해시가 달라지면 "그대로인 판정" 지름길을 타지 않고
-- 정규식 추출을 새로 하며, 이 사용자가 이미 AI로 뽑아 둔 사실(platform_notice_ai_facts)은 토큰 없이 다시 쓴다.
create or replace function public.requeue_graduation_matching(p_pattern text, p_limit integer default 200)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
begin
  if p_pattern is null or btrim(p_pattern) = '' then
    return 0;
  end if;
  with target as (
    select a.user_id, a.notice_id
    from public.user_notice_graduation_assessments a
    join public.platform_notices n on n.id = a.notice_id
    cross join lateral (
      select concat_ws(E'\n', n.title, n.body, (
        select string_agg(c.extracted_text, E'\n')
        from public.platform_notice_images i
        join public.platform_ocr_cache c on c.content_sha256 = i.content_sha256 and c.engine_version = i.engine_version
        where i.notice_id = n.id and i.status = 'ready'
      )) as text
    ) t
    where a.status = 'READY' and t.text ~* p_pattern
    order by n.first_seen desc
    limit least(greatest(coalesce(p_limit, 200), 1), 5000)
  ), updated as (
    update public.user_notice_graduation_assessments a
    set status = 'PENDING', input_hash = null
    from target
    where a.user_id = target.user_id and a.notice_id = target.notice_id
    returning 1
  )
  select count(*) into affected from updated;
  return affected;
end;
$$;
revoke all on function public.requeue_graduation_matching(text, integer) from public, anon, authenticated;
grant execute on function public.requeue_graduation_matching(text, integer) to service_role;
