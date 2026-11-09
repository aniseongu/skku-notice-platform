-- 키를 새로 등록한 사용자의 판정을 이미 모인 공지에도 채운다.
-- 판정 대상은 마감이 지나지 않은 공지로 줄인다: 마감일을 아는 글은 마감 전이어야 하고,
-- 마감일을 모르는 글은 처음 본 지 30일 안이어야 한다. 마감이 지난 글에는 Gemini 호출을 쓰지 않는다.
create or replace function public.list_byok_pending_school(p_user_id uuid, p_limit integer default 6)
returns table (notice_id text, title text, body text)
language sql stable security invoker set search_path = '' as $$
  select n.id, n.title,
         left(concat_ws(E'\n', n.body, (
           select string_agg(c.extracted_text, E'\n')
           from (select image.content_sha256, image.engine_version from public.platform_notice_images image
                 where image.notice_id = n.id and image.status = 'ready' order by image.image_url limit 3) ready
           join public.platform_ocr_cache c on c.content_sha256 = ready.content_sha256 and c.engine_version = ready.engine_version
         )), 6000)
  from public.user_byok_keys k
  join public.platform_notices n on true
  join public.platform_sources s on s.id = n.source_id and not s.external
  left join public.user_notice_judgments j on j.user_id = k.user_id and j.notice_id = n.id
  where k.user_id = p_user_id and k.disabled_at is null
    and (j.notice_id is null or (n.deadline is null and not j.deadline_checked))
    and (n.deadline >= now() or (n.deadline is null and n.first_seen >= now() - interval '30 days'))
    and (n.fetched_at is not null or n.first_seen < now() - interval '20 minutes')
    and (nullif(btrim(n.body), '') is not null or jsonb_array_length(n.images) = 0
         or (select count(*) from public.platform_notice_images i where i.notice_id = n.id and i.status = 'ready')
              >= least(jsonb_array_length(n.images), 3)
         or n.first_seen < now() - interval '2 hours')
  order by n.first_seen desc, n.id
  limit least(greatest(coalesce(p_limit, 6), 1), 6);
$$;
revoke all on function public.list_byok_pending_school(uuid, integer) from public, anon, authenticated;
grant execute on function public.list_byok_pending_school(uuid, integer) to service_role;

-- 화면용: 내 키로 아직 판정하지 못한, 마감이 지나지 않은 공지 수. 키가 없거나 꺼져 있으면 0이다.
-- 학교 공지는 30일, 외부 공고는 14일 안의 것만 센다(워커의 선택 기준과 같다).
create or replace function public.my_byok_backfill_count()
returns integer
language sql stable security invoker set search_path = '' as $$
  select count(*)::integer
  from public.user_byok_keys k
  join public.platform_notices n on true
  join public.platform_sources s on s.id = n.source_id
  where k.user_id = (select auth.uid()) and k.disabled_at is null
    and not exists (select 1 from public.user_notice_judgments j where j.user_id = k.user_id and j.notice_id = n.id)
    and (n.deadline >= now()
         or (n.deadline is null and n.first_seen >= now() - (case when s.external then interval '14 days' else interval '30 days' end)));
$$;
revoke all on function public.my_byok_backfill_count() from public, anon;
grant execute on function public.my_byok_backfill_count() to authenticated, service_role;
