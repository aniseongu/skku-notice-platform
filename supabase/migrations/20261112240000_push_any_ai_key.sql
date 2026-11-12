-- 알림 후보가 "AI 키가 있는 사용자"를 Gemini 표(user_byok_keys)로만 알아보던 것을 고친다(2026-11-12).
-- Groq·OpenRouter 키는 user_ai_keys에 있어, 그 키만 연결한 사용자는 학교 글 판정을 기다리지 않고 바로 알림이 가서
-- 이유 줄 없이 나갔고, 외부 인턴 공고의 AI 알림(관련 있음만 알림)은 아예 받지 못했다. 첫 설정은 "한 곳만 연결하면 돼요"라
-- Groq만 연결한 새 사용자가 생길 수 있다. AI를 꺼 둔 사용자(user_ai_preferences.ai_enabled = false)는 판정이 오지 않으므로
-- 기다리지 않는다. 나머지 조건은 20261112180000과 같다. 멱등이다.

-- 쓸 수 있는 키 중 가장 먼저 연결한 시각. 없으면 null. 외부 공고 알림은 이 시각 뒤에 처음 본 공고만 보낸다(예전과 같은 기준).
create or replace function public.active_ai_key_since(p_user uuid) returns timestamptz
language sql stable set search_path to '' as $$
  select min(created_at) from (
    select created_at from public.user_byok_keys where user_id = p_user and disabled_at is null
    union all
    select created_at from public.user_ai_keys where user_id = p_user and disabled_at is null
  ) keys;
$$;
revoke all on function public.active_ai_key_since(uuid) from public, anon, authenticated;
grant execute on function public.active_ai_key_since(uuid) to service_role;

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
           (ai_key.since is not null and coalesce(ai_pref.ai_enabled, true)) as has_key,
           school_judgment.verdict as verdict,
           case when school_judgment.verdict = 'relevant' then school_judgment.reason end as ai_reason
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
           null::text as ckind, notice.deadline, source.name as source_name,
           '{}'::text[] as hits, '{}'::text[] as excluded_hits,
           greatest(device.created_at, ai_key.since) as since,
           true as has_key, 'relevant'::text as verdict,
           judgment.reason as ai_reason
    from public.user_push_subscriptions device
    join lateral public.active_ai_key_since(device.user_id) ai_key(since) on ai_key.since is not null
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
