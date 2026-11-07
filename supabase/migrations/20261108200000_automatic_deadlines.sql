-- 판정과 마감 추출을 한 번에 수행하되, 이전 판정 중 마감을 확인하지 않은 글도 다시 처리한다.
alter table public.user_notice_judgments add column deadline_checked boolean not null default false;
update public.user_notice_judgments set deadline_checked = true where deadline is not null;

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
    and (n.fetched_at is not null or n.first_seen < now() - interval '20 minutes')
    and (jsonb_array_length(n.images) = 0
         or (select count(*) from public.platform_notice_images i where i.notice_id = n.id and i.status = 'ready')
              >= least(jsonb_array_length(n.images), 3)
         or n.first_seen < now() - interval '2 hours')
  order by n.first_seen desc, n.id
  limit least(greatest(coalesce(p_limit, 6), 1), 6);
$$;
revoke all on function public.list_byok_pending_school(uuid, integer) from public, anon, authenticated;
grant execute on function public.list_byok_pending_school(uuid, integer) to service_role;
