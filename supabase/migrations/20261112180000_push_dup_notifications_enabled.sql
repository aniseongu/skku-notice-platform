-- 같은 공지의 새 글 알림 중복 제외를 "알림이 켜진 게시판의 대표"만 인정하게 고친다(2026-11-12).
-- 대표 글의 게시판을 구독했어도 알림을 꺼 두었으면 그 글은 알림이 안 가므로, 그때는 다른 게시판 사본의 알림을 막지 않는다. 멱등이다.

create or replace function public.dup_loser_notify(p_id text, p_user uuid) returns boolean
language sql stable set search_path to '' as $$
  select exists (
    select 1 from public.platform_notices n
    join public.platform_notices o on o.id <> n.id and o.source_id <> n.source_id
      and (o.dup_key = n.dup_key or o.dup_text_key = n.dup_text_key)
      and abs(o.posted_on - n.posted_on) <= 3 and (o.first_seen, o.id) < (n.first_seen, n.id)
    where n.id = p_id and (n.dup_key is not null or n.dup_text_key is not null)
      and (exists (select 1 from public.platform_sources os where os.id = o.source_id and os.external)
        or exists (select 1 from public.user_source_subscriptions us
                   where us.user_id = p_user and us.source_id = o.source_id and us.notifications_enabled)));
$$;
revoke all on function public.dup_loser_notify(text, uuid) from public, anon, authenticated;
grant execute on function public.dup_loser_notify(text, uuid) to service_role;

create or replace function public.list_notice_push_candidates(p_limit integer default 20)
returns table (
  subscription_id uuid, user_id uuid, endpoint text, p256dh text, auth_secret text,
  notice_id text, title text, url text, silent boolean,
  kind text, change_marker timestamptz, change_kind text,
  source_name text, deadline timestamptz, matched_words text[], ai_reason text
) language sql stable security invoker set search_path = '' as $$
  with base as (
    select device.id as device_id, device.user_id, device.endpoint, device.p256dh, device.auth_secret,
           notice.id as nid, notice.title, notice.url, notice.first_seen, notice.changed_at, notice.change_kind as ckind,
           notice.deadline, source.name as source_name,
           public.notice_matched_words(notice.id, notice.title, notice.body, pref.keywords) as hits,
           public.notice_matched_words(notice.id, notice.title, notice.body, pref.excluded_keywords) as excluded_hits,
           greatest(device.created_at, source_sub.created_at) as since,
           (byok.user_id is not null and byok.disabled_at is null) as has_key,
           school_judgment.verdict as verdict,
           case when school_judgment.verdict = 'relevant' then school_judgment.reason end as ai_reason
    from public.user_push_subscriptions device
    join public.user_source_subscriptions source_sub
      on source_sub.user_id = device.user_id and source_sub.notifications_enabled
    join public.platform_notices notice on notice.source_id = source_sub.source_id
    join public.platform_sources source on source.id = notice.source_id and not source.external
    left join public.user_preferences pref on pref.user_id = device.user_id
    left join public.user_byok_keys byok on byok.user_id = device.user_id
    left join public.user_notice_judgments school_judgment
      on school_judgment.user_id = device.user_id and school_judgment.notice_id = notice.id
  ), ai as (
    select device.id as device_id, device.user_id, device.endpoint, device.p256dh, device.auth_secret,
           notice.id as nid, notice.title, notice.url, notice.first_seen, null::timestamptz as changed_at,
           null::text as ckind, notice.deadline, source.name as source_name,
           '{}'::text[] as hits, '{}'::text[] as excluded_hits,
           greatest(device.created_at, byok.created_at) as since,
           true as has_key, 'relevant'::text as verdict,
           judgment.reason as ai_reason
    from public.user_push_subscriptions device
    join public.user_byok_keys byok on byok.user_id = device.user_id and byok.disabled_at is null
    join public.user_notice_judgments judgment
      on judgment.user_id = device.user_id and judgment.verdict = 'relevant'
    join public.platform_notices notice on notice.id = judgment.notice_id
    join public.platform_sources source on source.id = notice.source_id and source.external
  ), picked as (
    select b.*, 'new_notice'::text as k, 'epoch'::timestamptz as marker
    from base b where b.first_seen > b.since and b.first_seen >= now() - interval '7 days'
      -- 같은 공지를 먼저 감지한 다른 글이 있으면(사용자가 볼 수 있는 게시판 안에서) 알리지 않는다. 대표 글 하나만 알린다.
      and not public.dup_loser_notify(b.nid, b.user_id)
      -- 본문이 사진뿐인 글은 사진 글자(OCR)를 읽은 뒤에 알린다(같은 글인지, 어떤 내용인지 안 뒤에 한 번만). 최대 3시간.
      and not public.waiting_for_ocr(b.nid, b.first_seen)
      -- 원본(alert_priority)처럼 제목에 인턴이 있는 학교 글이 AI 판정으로 관련 없음이면 알리지 않는다(키워드가 맞아도).
      and not (b.verdict = 'not_relevant' and b.title ~* '(인턴|\mintern(ship|ships|s)?\M)')
      -- 키가 있는 사용자는 학교 글 판정을 최대 3시간 기다린다(키워드가 맞았으면 바로). 원본은 판정될 때까지 기다리고, Gemini 장애가 70분 넘게 이어진 적이 있다.
      and (cardinality(b.hits) > 0 or not b.has_key or b.verdict is not null
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
      and not public.waiting_for_ocr(a.nid, a.first_seen)
  )
  select p.device_id, p.user_id, p.endpoint, p.p256dh, p.auth_secret, p.nid, p.title, p.url,
         case when p.k = 'changed' or p.ai_reason is not null then false
              else not (cardinality(p.hits) > 0 and cardinality(p.excluded_hits) = 0) end,
         p.k, p.marker, p.ckind, p.source_name, p.deadline, p.hits,
         case when p.k = 'new_notice' then p.ai_reason end
  from picked p
  left join public.user_notification_history history
    on history.subscription_id = p.device_id and history.notice_id = p.nid
   and history.kind = p.k and history.change_marker = p.marker
  where history.id is null or (history.status in ('pending', 'failed')
         and history.updated_at < now() - interval '30 minutes' and history.attempt_count < 3)
  order by coalesce(case when p.k = 'changed' then p.changed_at end, p.first_seen), p.device_id, p.nid
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;
revoke all on function public.list_notice_push_candidates(integer) from public, anon, authenticated;
grant execute on function public.list_notice_push_candidates(integer) to service_role;
