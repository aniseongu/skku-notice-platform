begin;

alter table public.user_preferences
  add column quiet_start time without time zone,
  add column quiet_end time without time zone,
  add constraint user_preferences_quiet_hours_check check (
    (quiet_start is null and quiet_end is null)
    or (quiet_start is not null and quiet_end is not null
        and quiet_start < time '24:00' and quiet_end < time '24:00' and quiet_start <> quiet_end)
  );

-- Zero attempts means this candidate has been deferred without claiming a send.
alter table public.user_notification_history
  add column deferred_at timestamptz,
  add column quiet_claim uuid,
  drop constraint user_notification_history_attempt_count_check,
  add constraint user_notification_history_attempt_count_check
    check (attempt_count between 0 and 3 and (attempt_count > 0 or deferred_at is not null));

alter table public.saved_deadline_reminder_history
  add column deferred_at timestamptz,
  add column quiet_claim uuid;

create index notice_push_deferred_idx on public.user_notification_history (subscription_id, deferred_at)
  where deferred_at is not null and status <> 'sent' and attempt_count < 3;
create index saved_deadline_deferred_idx on public.saved_deadline_reminder_history (subscription_id, deferred_at)
  where deferred_at is not null and status <> 'sent' and attempt_count < 3;
create index notice_push_quiet_claim_idx on public.user_notification_history (quiet_claim) where quiet_claim is not null;
create index saved_deadline_quiet_claim_idx on public.saved_deadline_reminder_history (quiet_claim) where quiet_claim is not null;

create function public.push_quiet_now(p_start time, p_end time, p_now timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_start is null or p_end is null then false
    when p_start < p_end then local_time >= p_start and local_time < p_end
    else local_time >= p_start or local_time < p_end
  end
  from (select (p_now at time zone 'Asia/Seoul')::time as local_time) clock;
$$;

-- Share candidate eligibility with the existing immediate delivery path.
create view public.notice_push_eligible (
  subscription_id, user_id, endpoint, p256dh, auth_secret,
  notice_id, title, url, silent, kind, change_marker, change_kind,
  source_name, deadline, matched_words, ai_reason, deadline_kind, candidate_at
) as
  with base as (
    select device.id as device_id, device.user_id, device.endpoint, device.p256dh, device.auth_secret,
           notice.id as nid, notice.title, notice.url, notice.first_seen, notice.changed_at, notice.change_kind as ckind,
           coalesce(notice.deadline, school_judgment.deadline) as deadline,
           case when notice.deadline is not null then '마감' else coalesce(school_judgment.deadline_kind, '마감') end as dkind,
           source.name as source_name,
           public.notice_matched_words(notice.id, notice.title, notice.body, pref.keywords) as hits,
           public.notice_matched_words(notice.id, notice.title, notice.body, pref.excluded_keywords) as excluded_hits,
           greatest(device.created_at, source_sub.created_at) as since,
           (ai_key.since is not null and coalesce(ai_pref.ai_enabled, true)) as has_key,
           coalesce(device.alert_all_new, false) as alert_all_new,
           school_judgment.verdict as verdict,
           school_judgment.reason as ai_reason,
           notice.posted_on
    from public.user_push_subscriptions device
    join public.user_source_subscriptions source_sub
      on source_sub.user_id = device.user_id and source_sub.notifications_enabled
    join public.platform_notices notice on notice.source_id = source_sub.source_id
    join public.platform_sources source on source.id = notice.source_id and not source.external
    left join public.user_preferences pref on pref.user_id = device.user_id
    left join lateral public.active_ai_key_since(device.user_id) ai_key(since) on true
    left join public.user_ai_preferences ai_pref on ai_pref.user_id = device.user_id
    left join public.user_notice_judgments school_judgment
      on school_judgment.user_id = device.user_id and school_judgment.notice_id = notice.id
  ), ai as (
    select device.id as device_id, device.user_id, device.endpoint, device.p256dh, device.auth_secret,
           notice.id as nid, notice.title, notice.url, notice.first_seen, null::timestamptz as changed_at,
           null::text as ckind, coalesce(notice.deadline, judgment.deadline) as deadline,
           case when notice.deadline is not null then '마감' else coalesce(judgment.deadline_kind, '마감') end as dkind,
           source.name as source_name,
           '{}'::text[] as hits, '{}'::text[] as excluded_hits,
           greatest(device.created_at, ai_key.since) as since,
           true as has_key, false as alert_all_new, 'relevant'::text as verdict,
           judgment.reason as ai_reason,
           notice.posted_on
    from public.user_push_subscriptions device
    join lateral public.active_ai_key_since(device.user_id) ai_key(since) on ai_key.since is not null
    join public.user_notice_judgments judgment
      on judgment.user_id = device.user_id and judgment.verdict = 'relevant'
    join public.platform_notices notice on notice.id = judgment.notice_id
    -- 현장실습(coop)은 한 번에 수백 건이 들어와서 새 공지 알림 후보에서 뺀다.
    join public.platform_sources source on source.id = notice.source_id and source.external and not source.coop
  ), picked as (
    select b.*, 'new_notice'::text as k, 'epoch'::timestamptz as marker
    from base b where b.first_seen > b.since and b.first_seen >= now() - interval '7 days'
      -- 처음 수집되는 게시판이나 글 번호가 바뀐 게시판의 옛 글(게시일이 처음 저장된 날보다 3일 넘게 앞섬)은 새 글 알림에서 뺀다. 게시일이 없으면 기존대로.
      and (b.posted_on is null or b.posted_on >= (b.first_seen at time zone 'Asia/Seoul')::date - 3)
      -- 같은 공지를 먼저 감지한 다른 글이 있으면(사용자가 볼 수 있는 게시판 안에서) 알리지 않는다. 대표 글 하나만 알린다.
      and not public.dup_loser_notify(b.nid, b.user_id)
      -- 본문이 사진뿐인 글은 사진 글자(OCR)를 읽은 뒤에 알린다(같은 글인지, 어떤 내용인지 안 뒤에 한 번만). 최대 3시간.
      and not public.waiting_for_ocr(b.nid, b.first_seen)
      -- 원본(alert_priority)처럼 제목에 인턴이 있는 학교 글이 AI 판정으로 관련 없음이면 알리지 않는다(키워드가 맞아도).
      and not (b.verdict = 'not_relevant' and b.title ~* '(인턴|\mintern(ship|ships|s)?\M)')
      -- AI를 쓰는 사용자는 키워드가 맞아도 학교 글 판정이 끝난 뒤에 알린다(알림에 판정 문구를 넣기 위해). 최대 3시간 기다린 뒤에는 판정 없이 보낸다(AI 장애 대비, Gemini 장애가 70분 넘게 이어진 적이 있다).
      and (not b.has_key or b.verdict is not null
           or b.first_seen < now() - interval '3 hours')
    union all
    select b.*, 'changed'::text, b.changed_at
    from base b
    where b.changed_at is not null and b.changed_at > b.since and b.changed_at >= now() - interval '7 days'
      and (cardinality(b.hits) > 0 or b.verdict in ('relevant', 'maybe') or exists (
        select 1 from public.user_notice_states state
        where state.user_id = b.user_id and state.notice_id = b.nid and state.is_saved))
    union all
    select a.*, 'new_notice'::text, 'epoch'::timestamptz
    from ai a where a.first_seen > a.since and a.first_seen >= now() - interval '7 days'
      and not public.dup_loser(a.nid, a.user_id)
      -- 처음 수집되는 게시판이나 글 번호가 바뀐 게시판의 옛 글(게시일이 처음 저장된 날보다 3일 넘게 앞섬)은 새 글 알림에서 뺀다. 게시일이 없으면 기존대로.
      and (a.posted_on is null or a.posted_on >= (a.first_seen at time zone 'Asia/Seoul')::date - 3)
      and not public.waiting_for_ocr(a.nid, a.first_seen)
  )
  select p.device_id, p.user_id, p.endpoint, p.p256dh, p.auth_secret, p.nid, p.title, p.url,
         case when p.k = 'changed' or (p.verdict = 'relevant' and p.ai_reason is not null) then false
              else not ((cardinality(p.hits) > 0 or p.alert_all_new) and cardinality(p.excluded_hits) = 0) end,
         p.k, p.marker, p.ckind, p.source_name, p.deadline, p.hits,
         case when p.k = 'new_notice' then p.ai_reason end,
         case when p.deadline is not null then p.dkind end,
         case when p.k = 'changed' then p.changed_at else p.first_seen end
  from picked p;

create view public.notice_push_ready as
select e.*
from public.notice_push_eligible e
left join public.user_notification_history h
  on h.subscription_id = e.subscription_id and h.user_id = e.user_id and h.notice_id = e.notice_id
  and h.kind = e.kind and h.change_marker = e.change_marker
where h.id is null or (h.deferred_at is null and h.status in ('pending', 'failed')
  and h.updated_at < now() - interval '30 minutes' and h.attempt_count < 3);

create or replace function public.list_notice_push_candidates(p_limit integer default 20)
returns table (
  subscription_id uuid, user_id uuid, endpoint text, p256dh text, auth_secret text,
  notice_id text, title text, url text, silent boolean,
  kind text, change_marker timestamptz, change_kind text,
  source_name text, deadline timestamptz, matched_words text[], ai_reason text, deadline_kind text
) language sql stable security definer set search_path = '' as $$
  select r.subscription_id, r.user_id, r.endpoint, r.p256dh, r.auth_secret, r.notice_id, r.title, r.url,
         r.silent, r.kind, r.change_marker, r.change_kind, r.source_name, r.deadline, r.matched_words, r.ai_reason,
         r.deadline_kind
  from public.notice_push_ready r
  left join public.user_preferences pref on pref.user_id = r.user_id
  where not public.push_quiet_now(pref.quiet_start, pref.quiet_end, statement_timestamp())
  order by r.candidate_at, r.subscription_id, r.notice_id
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

create or replace function public.claim_notice_push(
  p_user_id uuid, p_subscription_id uuid, p_notice_id text,
  p_kind text default 'new_notice', p_change_marker timestamptz default 'epoch')
returns bigint language plpgsql security definer set search_path = '' as $$
declare claimed_id bigint;
begin
  insert into public.user_notification_history (user_id, subscription_id, notice_id, kind, change_marker, status)
  select d.user_id, d.id, p_notice_id, p_kind, p_change_marker, 'pending'
  from public.user_push_subscriptions d
  left join public.user_preferences pref on pref.user_id = d.user_id
  where d.id = p_subscription_id and d.user_id = p_user_id
    and not public.push_quiet_now(pref.quiet_start, pref.quiet_end, statement_timestamp())
  on conflict (subscription_id, notice_id, kind, change_marker) do update
    set status = 'pending', attempt_count = public.user_notification_history.attempt_count + 1, updated_at = now()
    where public.user_notification_history.user_id = excluded.user_id
      and public.user_notification_history.deferred_at is null
      and public.user_notification_history.status in ('failed', 'pending')
      and public.user_notification_history.updated_at < now() - interval '30 minutes'
      and public.user_notification_history.attempt_count < 3
  returning id into claimed_id;
  return claimed_id;
end;
$$;

create view public.saved_deadline_push_eligible as
select n.user_id, n.notice_id, n.title, n.url, n.source_name,
       d.id as subscription_id, d.endpoint, d.p256dh, d.auth_secret, n.deadline,
       case when n.verdict = 'relevant' and n.reason is not null then false
            else not ((d.alert_all_new or cardinality(
                         public.notice_matched_words(n.notice_id, n.title, n.body, pref.keywords)) > 0)
                      and cardinality(
                         public.notice_matched_words(n.notice_id, n.title, n.body, pref.excluded_keywords)) = 0)
       end as silent
from public.saved_deadline_reminder_notices n
join public.user_push_subscriptions d on d.user_id = n.user_id
left join public.user_preferences pref on pref.user_id = n.user_id;

create function public.saved_deadline_push_ready(p_now timestamptz)
returns table (
  user_id uuid, subscription_id uuid, notice_id text, days_before integer, updated_at timestamptz, deadline timestamptz
) language sql stable security definer set search_path = '' as $$
  select n.user_id, d.id, n.notice_id, stage.days_before, h.updated_at, n.deadline
  from public.saved_deadline_reminder_notices n
  join public.user_push_subscriptions d on d.user_id = n.user_id
  cross join lateral (select public.saved_deadline_reminder_days(n.deadline, p_now) as days_before) stage
  left join public.saved_deadline_reminder_history h
    on h.user_id = n.user_id and h.subscription_id = d.id and h.notice_id = n.notice_id
   and h.days_before = stage.days_before
  where stage.days_before is not null
    and (h.id is null or (h.deferred_at is null and h.status in ('pending', 'failed') and h.attempt_count < 3
                         and h.updated_at < statement_timestamp() - interval '30 minutes'));
$$;

create or replace function public.list_saved_deadline_reminders(
  p_limit integer default 20, p_now timestamptz default statement_timestamp()
) returns table (user_id uuid, subscription_id uuid, notice_id text, days_before integer)
language sql stable security definer set search_path = '' as $$
  select r.user_id, r.subscription_id, r.notice_id, r.days_before
  from public.saved_deadline_push_ready(p_now) r
  left join public.user_preferences pref on pref.user_id = r.user_id
  where not public.push_quiet_now(pref.quiet_start, pref.quiet_end, p_now)
  order by r.days_before, r.updated_at nulls first, r.deadline, r.subscription_id, r.notice_id
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

create or replace function public.claim_saved_deadline_reminder(
  p_user_id uuid, p_subscription_id uuid, p_notice_id text, p_days_before integer,
  p_now timestamptz default statement_timestamp()
) returns jsonb
language sql volatile security definer set search_path = '' as $$
  -- 다시 후보를 확인하고, 최신 기기와 공지 정보는 claim에 성공한 경우에만 돌려준다.
  with candidate as materialized (
    select c.user_id, c.notice_id, c.title, c.url, c.source_name,
           c.subscription_id, c.endpoint, c.p256dh, c.auth_secret, p_days_before as days_before, c.silent
    from public.saved_deadline_push_eligible c
    left join public.user_preferences pref on pref.user_id = c.user_id
    where c.user_id = p_user_id and c.notice_id = p_notice_id and c.subscription_id = p_subscription_id
      and public.saved_deadline_reminder_days(c.deadline, p_now) = p_days_before
      and not public.push_quiet_now(pref.quiet_start, pref.quiet_end, p_now)
  ), claimed as (
    insert into public.saved_deadline_reminder_history as h
      (user_id, subscription_id, notice_id, days_before, updated_at)
    select user_id, subscription_id, notice_id, days_before, statement_timestamp() from candidate
    on conflict (subscription_id, user_id, notice_id, days_before) do update
      set status = 'pending', attempt_count = h.attempt_count + 1, updated_at = statement_timestamp()
      where h.deferred_at is null and h.status in ('pending', 'failed') and h.attempt_count < 3
        and h.updated_at < statement_timestamp() - interval '30 minutes'
    returning h.id, h.attempt_count
  )
  select to_jsonb(candidate) || jsonb_build_object('claim_id', claimed.id, 'attempt_count', claimed.attempt_count)
  from candidate cross join claimed;
$$;

create or replace function public.mark_saved_deadline_reminder(p_id bigint, p_attempt_count integer, p_status text)
returns void
language sql volatile security definer set search_path = '' as $$
  update public.saved_deadline_reminder_history
     set status = p_status, updated_at = statement_timestamp()
   where id = p_id and attempt_count = p_attempt_count and status = 'pending' and deferred_at is null
     and p_status in ('sent', 'failed');
$$;

create function public.defer_quiet_pushes(p_now timestamptz default statement_timestamp(), p_limit integer default 500)
returns void language plpgsql security definer set search_path = '' as $$
declare
  row_limit integer := least(greatest(coalesce(p_limit, 500), 0), 500);
  staged_reminders integer;
begin
  if row_limit = 0 or not exists (
    select 1 from public.user_preferences p where public.push_quiet_now(p.quiet_start, p.quiet_end, p_now)
  ) then return;
  end if;

  -- Reserve room for reminders whose staging window closes at noon KST.
  insert into public.saved_deadline_reminder_history as h
    (user_id, subscription_id, notice_id, days_before, status, attempt_count, deferred_at)
  select r.user_id, r.subscription_id, r.notice_id, r.days_before, 'pending', 0, p_now
  from public.saved_deadline_push_ready(p_now) r
  join public.user_preferences p on p.user_id = r.user_id
  where public.push_quiet_now(p.quiet_start, p.quiet_end, p_now)
  order by r.days_before, r.deadline, r.subscription_id, r.user_id, r.notice_id
  limit row_limit
  on conflict (subscription_id, user_id, notice_id, days_before) do update
    set deferred_at = excluded.deferred_at
    where h.deferred_at is null and h.status in ('pending', 'failed')
      and h.attempt_count < 3 and h.updated_at < statement_timestamp() - interval '30 minutes';
  get diagnostics staged_reminders = row_count;
  if staged_reminders = row_limit then return; end if;

  insert into public.user_notification_history as h
    (user_id, subscription_id, notice_id, kind, change_marker, status, attempt_count, deferred_at)
  select r.user_id, r.subscription_id, r.notice_id, r.kind, r.change_marker, 'pending', 0, p_now
  from public.notice_push_ready r
  join public.user_preferences p on p.user_id = r.user_id
  where public.push_quiet_now(p.quiet_start, p.quiet_end, p_now)
  order by r.candidate_at, r.subscription_id, r.notice_id, r.kind, r.change_marker
  limit row_limit - staged_reminders
  on conflict (subscription_id, notice_id, kind, change_marker) do update
    set deferred_at = excluded.deferred_at
    where h.user_id = excluded.user_id and h.deferred_at is null and h.status in ('pending', 'failed')
      and h.attempt_count < 3 and h.updated_at < statement_timestamp() - interval '30 minutes';
end;
$$;

create function public.claim_deferred_pushes(p_limit integer default 20, p_now timestamptz default statement_timestamp())
returns table (claim_token uuid, candidates jsonb)
language sql volatile security definer set search_path = '' as $$
  with ready as materialized (
    -- Revalidate before sending, including current notice subscriptions and saved/application state.
    select h.id, h.user_id, h.subscription_id, h.deferred_at, false as reminder,
           to_jsonb(e) - 'candidate_at' as payload
    from public.user_notification_history h
    join public.notice_push_eligible e using (subscription_id, user_id, notice_id, kind, change_marker)
    where h.deferred_at is not null and h.status <> 'sent' and h.attempt_count < 3
      and (h.attempt_count = 0 or h.updated_at < statement_timestamp() - interval '30 minutes')
    union all
    select h.id, h.user_id, h.subscription_id, h.deferred_at, true,
           to_jsonb(e) || jsonb_build_object(
             'days_before', h.days_before,
             'days_remaining', (e.deadline at time zone 'Asia/Seoul')::date - (p_now at time zone 'Asia/Seoul')::date
           )
    from public.saved_deadline_reminder_history h
    join public.saved_deadline_push_eligible e using (subscription_id, user_id, notice_id)
    where h.deferred_at is not null and h.status <> 'sent' and h.attempt_count < 3
      and (h.attempt_count = 0 or h.updated_at < statement_timestamp() - interval '30 minutes')
      and e.deadline > p_now
  ), first_deferred as (
    select r.user_id, r.subscription_id, min(r.deferred_at) as oldest
    from ready r group by r.user_id, r.subscription_id
  ), devices as materialized (
    -- Lock whole devices so concurrent workers cannot split one digest across multiple sends.
    select d.id, d.user_id, gen_random_uuid() as token
    from first_deferred f
    join public.user_push_subscriptions d on d.id = f.subscription_id and d.user_id = f.user_id
    left join public.user_preferences p on p.user_id = d.user_id
    where not public.push_quiet_now(p.quiet_start, p.quiet_end, p_now)
    order by f.oldest, d.id
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for no key update of d skip locked
  ), notices as (
    update public.user_notification_history h
      set quiet_claim = d.token, status = 'pending', attempt_count = h.attempt_count + 1,
          updated_at = statement_timestamp()
    from ready r join devices d on d.id = r.subscription_id and d.user_id = r.user_id
    where not r.reminder and h.id = r.id and h.deferred_at is not null and h.status <> 'sent'
      and h.attempt_count < 3 and (h.attempt_count = 0 or h.updated_at < statement_timestamp() - interval '30 minutes')
    returning d.token, r.deferred_at, r.payload
  ), reminders as (
    update public.saved_deadline_reminder_history h
      set quiet_claim = d.token, status = 'pending', attempt_count = h.attempt_count + 1,
          updated_at = statement_timestamp()
    from ready r join devices d on d.id = r.subscription_id and d.user_id = r.user_id
    where r.reminder and h.id = r.id and h.deferred_at is not null and h.status <> 'sent'
      and h.attempt_count < 3 and (h.attempt_count = 0 or h.updated_at < statement_timestamp() - interval '30 minutes')
    returning d.token, r.deferred_at, r.payload
  )
  select c.token, jsonb_agg(c.payload order by c.deferred_at, c.payload->>'notice_id',
                                              c.payload->>'kind', c.payload->>'days_before')
  from (select * from notices union all select * from reminders) c
  group by c.token;
$$;

create function public.mark_deferred_pushes(p_claim_token uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status is null or p_status not in ('sent', 'failed') then return;
  end if;
  update public.user_notification_history
     set status = p_status, quiet_claim = null, updated_at = statement_timestamp()
   where quiet_claim = p_claim_token and status = 'pending';
  update public.saved_deadline_reminder_history
     set status = p_status, quiet_claim = null, updated_at = statement_timestamp()
   where quiet_claim = p_claim_token and status = 'pending';
end;
$$;

revoke all on public.notice_push_eligible, public.notice_push_ready, public.saved_deadline_push_eligible
  from public, anon, authenticated, service_role;
revoke all on function public.push_quiet_now(time, time, timestamptz), public.saved_deadline_push_ready(timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.defer_quiet_pushes(timestamptz, integer),
  public.claim_deferred_pushes(integer, timestamptz), public.mark_deferred_pushes(uuid, text)
  from public, anon, authenticated;
grant execute on function public.defer_quiet_pushes(timestamptz, integer),
  public.claim_deferred_pushes(integer, timestamptz), public.mark_deferred_pushes(uuid, text)
  to service_role;

commit;
