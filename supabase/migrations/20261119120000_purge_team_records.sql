-- 보관 정리에 팀 모집 기록 정리를 합친다. purge_expired_data 본문은 20261113140000과 같고 team 줄만 더했다(멱등, 권한 동일).

create or replace function public.purge_expired_data(
  p_closed_days integer default 30, p_stale_days integer default 90, p_limit integer default 500
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  gone text[];
  notices integer := 0;
  coop integer := 0;
  ocr integer := 0;
  alerts integer := 0;
  marks integer := 0;
  team integer := 0;
begin
  -- expires_at이 지난 공지는 저장한 사용자가 있어도 지운다(딸린 사용자 행은 on delete cascade). 번호는 기록하지 않는다.
  delete from public.platform_notices where id in (
    select n.id from public.platform_notices n
    where n.expires_at is not null and n.expires_at < now()
    order by n.expires_at
    limit greatest(p_limit, 0));
  get diagnostics coop = row_count;

  select coalesce(array_agg(x.id), '{}') into gone from (
    select n.id from public.platform_notices n
    where ((n.deadline is not null and n.deadline < now() - make_interval(days => p_closed_days))
        or (n.deadline is null and n.first_seen < now() - make_interval(days => p_stale_days)))
      and n.expires_at is null
      and not exists (select 1 from public.user_notice_states s where s.notice_id = n.id and s.is_saved)
    order by n.first_seen
    limit greatest(p_limit, 0)
  ) x;
  insert into public.platform_notice_tombstones (id) select unnest(gone) on conflict do nothing;
  delete from public.platform_notices where id = any(gone);
  get diagnostics notices = row_count;

  with orphan as (
    select c.content_sha256, c.engine_version from public.platform_ocr_cache c
    where c.processed_at < now() - interval '7 days'
      and not exists (select 1 from public.platform_notice_images i
                      where i.content_sha256 = c.content_sha256 and i.engine_version = c.engine_version)
    limit greatest(p_limit, 0)
  )
  delete from public.platform_ocr_cache c using orphan o
   where c.content_sha256 = o.content_sha256 and c.engine_version = o.engine_version;
  get diagnostics ocr = row_count;

  delete from public.user_canvas_alerts where status = 'sent' and updated_at < now() - interval '30 days';
  get diagnostics alerts = row_count;

  delete from public.platform_notice_tombstones where deleted_at < now() - interval '400 days';
  get diagnostics marks = row_count;

  -- 팀 모집: 마감 30일·삭제 7일 지난 글과 2일 지난 빈도 기록(team_purge_expired는 security definer, 지운 글 수를 돌려준다).
  team := public.team_purge_expired();
  return jsonb_build_object('notices', notices, 'expired', coop, 'ocr_cache', ocr, 'canvas_alerts', alerts, 'old_tombstones', marks, 'team', team);
end $$;
revoke all on function public.purge_expired_data(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.purge_expired_data(integer, integer, integer) to service_role;
