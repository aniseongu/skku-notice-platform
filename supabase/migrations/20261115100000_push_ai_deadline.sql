-- 알림의 마감 줄을 앱 화면과 같게 한다(2026-11-15 사용자 지시: 알림을 로그인 화면 예시처럼).
-- 학교 공지는 공지 표에 마감이 없고 AI가 본문에서 뽑은 날짜가 사용자별 판정(user_notice_judgments.deadline)에 있다.
-- 화면(web/src/notice-view.ts withMyDeadline)처럼 공지의 마감을 먼저 쓰고 없으면 판정의 날짜와 종류(마감·일정)를 쓴다.
-- 지난 7일 알림 중 학교 새 공지 13건, 수정 알림 12건이 이 날짜가 있는데 마감 줄 없이 나갔다.
-- 돌려주는 열(deadline_kind)이 늘어 create or replace로는 바꿀 수 없어 한 트랜잭션에서 지우고 다시 만든다. 나머지 규칙은 20261113140000과 같다.
begin;
drop function if exists public.list_notice_push_candidates(integer);

create function public.list_notice_push_candidates(p_limit integer default 20)
returns table (
  subscription_id uuid, user_id uuid, endpoint text, p256dh text, auth_secret text,
  notice_id text, title text, url text, silent boolean,
  kind text, change_marker timestamptz, change_kind text,
  source_name text, deadline timestamptz, matched_words text[], ai_reason text, deadline_kind text
) language sql stable security invoker set search_path = '' as $$
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
           school_judgment.verdict as verdict,
           school_judgment.reason as ai_reason
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
           true as has_key, 'relevant'::text as verdict,
           judgment.reason as ai_reason
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
      and not public.waiting_for_ocr(a.nid, a.first_seen)
  )
  select p.device_id, p.user_id, p.endpoint, p.p256dh, p.auth_secret, p.nid, p.title, p.url,
         case when p.k = 'changed' or (p.verdict = 'relevant' and p.ai_reason is not null) then false
              else not (cardinality(p.hits) > 0 and cardinality(p.excluded_hits) = 0) end,
         p.k, p.marker, p.ckind, p.source_name, p.deadline, p.hits,
         case when p.k = 'new_notice' then p.ai_reason end,
         case when p.deadline is not null then p.dkind end
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
commit;
