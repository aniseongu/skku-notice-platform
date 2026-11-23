begin;

create table public.saved_deadline_reminder_history (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  notice_id text not null,
  subscription_id uuid not null,
  days_before integer not null check (days_before in (3, 1)),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempt_count integer not null default 1,
  updated_at timestamptz not null default now(),
  foreign key (subscription_id, user_id) references public.user_push_subscriptions(id, user_id) on delete cascade,
  unique (subscription_id, user_id, notice_id, days_before)
);
create index saved_deadline_reminder_history_updated_idx on public.saved_deadline_reminder_history (updated_at);
alter table public.saved_deadline_reminder_history enable row level security;
revoke all on public.saved_deadline_reminder_history from public, anon, authenticated, service_role;
revoke all on sequence public.saved_deadline_reminder_history_id_seq from public, anon, authenticated, service_role;

-- 저장한 공지는 게시판 알림 설정과 무관하게 알린다(외부 인턴 공고는 구독 행이 없으므로 저장을 알림 동의로 본다).
-- 기회함 기록은 저장 해제 뒤에도 남는다. 저장 여부는 공지 상태, 지원 진행 여부는 기회함에서 읽는다.
create view public.saved_deadline_reminder_notices as
select s.user_id, n.id as notice_id, n.title, n.url, n.body, source.name as source_name,
       coalesce(n.deadline, case when j.deadline_kind = '마감' then j.deadline end) as deadline, j.verdict, j.reason
from public.user_notice_states s
join public.platform_notices n on n.id = s.notice_id
join public.platform_sources source on source.id = n.source_id
left join public.user_opportunities o on o.user_id = s.user_id and o.notice_id = s.notice_id
left join public.user_notice_judgments j on j.user_id = s.user_id and j.notice_id = s.notice_id
where s.is_saved
  and coalesce(o.status, 'interested') in ('interested', 'preparing')
  and (n.deadline is not null or (j.deadline is not null and j.deadline_kind = '마감'));
revoke all on public.saved_deadline_reminder_notices from public, anon, authenticated, service_role;

create function public.saved_deadline_reminder_days(p_deadline timestamptz, p_now timestamptz)
returns integer
language sql immutable strict security definer set search_path = '' as $$
  select case when p_deadline > p_now and local_time::time >= time '09:00' and local_time::time < time '12:00'
                    and days_left in (3, 1)
              then days_left end
  from (select p_now at time zone 'Asia/Seoul' as local_time) clock
  cross join lateral (select (p_deadline at time zone 'Asia/Seoul')::date - clock.local_time::date as days_left) stage;
$$;
revoke all on function public.saved_deadline_reminder_days(timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

create function public.list_saved_deadline_reminders(
  p_limit integer default 20, p_now timestamptz default statement_timestamp()
) returns table (user_id uuid, subscription_id uuid, notice_id text, days_before integer)
language sql stable security definer set search_path = '' as $$
  select n.user_id, d.id, n.notice_id, stage.days_before
  from public.saved_deadline_reminder_notices n
  join public.user_push_subscriptions d on d.user_id = n.user_id
  cross join lateral (select public.saved_deadline_reminder_days(n.deadline, p_now) as days_before) stage
  left join public.saved_deadline_reminder_history h
    on h.user_id = n.user_id and h.subscription_id = d.id and h.notice_id = n.notice_id
   and h.days_before = stage.days_before
  where stage.days_before is not null
    and (h.id is null or (h.status in ('pending', 'failed') and h.attempt_count < 3
                         and h.updated_at < statement_timestamp() - interval '30 minutes'))
  order by stage.days_before, h.updated_at nulls first, n.deadline, d.id, n.notice_id
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

create function public.claim_saved_deadline_reminder(
  p_user_id uuid, p_subscription_id uuid, p_notice_id text, p_days_before integer,
  p_now timestamptz default statement_timestamp()
) returns jsonb
language sql volatile security definer set search_path = '' as $$
  -- 다시 후보를 확인하고, 최신 기기와 공지 정보는 claim에 성공한 경우에만 돌려준다.
  with candidate as materialized (
    select n.user_id, n.notice_id, n.title, n.url, n.source_name,
           d.id as subscription_id, d.endpoint, d.p256dh, d.auth_secret,
           p_days_before as days_before,
           case when n.verdict = 'relevant' and n.reason is not null then false
                else not ((d.alert_all_new or cardinality(
                             public.notice_matched_words(n.notice_id, n.title, n.body, pref.keywords)) > 0)
                          and cardinality(
                             public.notice_matched_words(n.notice_id, n.title, n.body, pref.excluded_keywords)) = 0)
           end as silent
    from public.saved_deadline_reminder_notices n
    join public.user_push_subscriptions d on d.user_id = n.user_id and d.id = p_subscription_id
    left join public.user_preferences pref on pref.user_id = n.user_id
    where n.user_id = p_user_id and n.notice_id = p_notice_id
      and public.saved_deadline_reminder_days(n.deadline, p_now) = p_days_before
  ), claimed as (
    insert into public.saved_deadline_reminder_history as h
      (user_id, subscription_id, notice_id, days_before, updated_at)
    select user_id, subscription_id, notice_id, days_before, statement_timestamp() from candidate
    on conflict (subscription_id, user_id, notice_id, days_before) do update
      set status = 'pending', attempt_count = h.attempt_count + 1, updated_at = statement_timestamp()
      where h.status in ('pending', 'failed') and h.attempt_count < 3
        and h.updated_at < statement_timestamp() - interval '30 minutes'
    returning h.id, h.attempt_count
  )
  select to_jsonb(candidate) || jsonb_build_object('claim_id', claimed.id, 'attempt_count', claimed.attempt_count)
  from candidate cross join claimed;
$$;

create function public.mark_saved_deadline_reminder(p_id bigint, p_attempt_count integer, p_status text)
returns void
language sql volatile security definer set search_path = '' as $$
  update public.saved_deadline_reminder_history
     set status = p_status, updated_at = statement_timestamp()
   where id = p_id and attempt_count = p_attempt_count and status = 'pending'
     and p_status in ('sent', 'failed');
$$;

revoke all on function public.list_saved_deadline_reminders(integer, timestamptz),
  public.claim_saved_deadline_reminder(uuid, uuid, text, integer, timestamptz),
  public.mark_saved_deadline_reminder(bigint, integer, text) from public, anon, authenticated;
grant execute on function public.list_saved_deadline_reminders(integer, timestamptz),
  public.claim_saved_deadline_reminder(uuid, uuid, text, integer, timestamptz),
  public.mark_saved_deadline_reminder(bigint, integer, text) to service_role;

create or replace function public.purge_expired_data(
  p_closed_days integer default 30, p_stale_days integer default 90, p_limit integer default 500
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  gone text[];
  notices integer := 0;
  coop integer := 0;
  ocr integer := 0;
  alerts integer := 0;
  marks integer := 0;
  team integer := 0;
  qe integer := 0;
  saved_reminders integer := 0;
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
  qe := public.qe_purge();
  delete from public.saved_deadline_reminder_history where id in (
    select h.id from public.saved_deadline_reminder_history h
    where h.updated_at < now() - interval '90 days'
    order by h.updated_at, h.id
    limit greatest(p_limit, 0));
  get diagnostics saved_reminders = row_count;

  return jsonb_build_object('notices', notices, 'expired', coop, 'ocr_cache', ocr, 'canvas_alerts', alerts, 'old_tombstones', marks, 'team', team, 'qe', qe,
                            'saved_deadline_reminders', saved_reminders);
end $$;
revoke all on function public.purge_expired_data(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.purge_expired_data(integer, integer, integer) to service_role;

commit;
