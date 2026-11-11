-- 서버에 쌓이는 데이터의 보관 기준(사용자 지시 2026-11-11). 사용자 화면에서는 마감된 공지가 이미 목록에서 빠지므로, 서버는 유예를 둔 뒤 지운다.
--  - 마감이 있는 공지: 마감 30일 뒤.  마감이 없는 공지: 처음 본 지 90일 뒤.
--  - 누군가 저장한 공지는 지우지 않는다(저장한 글이 사라지면 안 된다).
--  - 공지를 지우면 그 공지에 딸린 판정·요약·번역·알림 기록·그림은 함께 지워진다(모두 on delete cascade).
--  - 그림 글자 읽기 캐시는 어느 공지의 그림도 가리키지 않고 7일이 지나면 지운다. 보낸 지 30일 지난 아이캠퍼스 알림도 지운다.
-- 지운 공지가 학교 목록 첫 페이지에 남아 있으면 수집기가 새 글로 다시 넣어 옛 공지 알림이 갈 수 있으므로, 지운 번호를 기록해 두고 다시 넣지 않는다.
-- 한 번에 많이 지우지 않는다(배치). 여러 번 실행해도 안전하다.
create table if not exists public.platform_notice_tombstones (
  id text primary key,
  deleted_at timestamptz not null default now()
);
alter table public.platform_notice_tombstones enable row level security;
revoke all on public.platform_notice_tombstones from public, anon, authenticated;
grant all on public.platform_notice_tombstones to service_role;

create or replace function public.skip_deleted_notice() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.platform_notice_tombstones t where t.id = new.id) then
    return null;  -- 이미 지운 공지는 다시 넣지 않는다(건너뜀)
  end if;
  return new;
end $$;
drop trigger if exists platform_notices_skip_deleted on public.platform_notices;
create trigger platform_notices_skip_deleted before insert on public.platform_notices
  for each row execute function public.skip_deleted_notice();

create or replace function public.purge_expired_data(
  p_closed_days integer default 30, p_stale_days integer default 90, p_limit integer default 500
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  gone text[];
  notices integer := 0;
  ocr integer := 0;
  alerts integer := 0;
  marks integer := 0;
begin
  select coalesce(array_agg(x.id), '{}') into gone from (
    select n.id from public.platform_notices n
    where ((n.deadline is not null and n.deadline < now() - make_interval(days => p_closed_days))
        or (n.deadline is null and n.first_seen < now() - make_interval(days => p_stale_days)))
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
  return jsonb_build_object('notices', notices, 'ocr_cache', ocr, 'canvas_alerts', alerts, 'old_tombstones', marks);
end $$;
revoke all on function public.purge_expired_data(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.purge_expired_data(integer, integer, integer) to service_role;
