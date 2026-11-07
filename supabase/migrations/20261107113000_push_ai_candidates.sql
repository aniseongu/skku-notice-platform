-- External internship postings notify only when the user's own Gemini judgment says "relevant" (original rule).
-- Only postings first seen after the key was registered count, so registering a key never floods old postings.
-- External postings never produce "[수정]" alerts, like the original.
drop function public.list_notice_push_candidates(integer);
create function public.list_notice_push_candidates(p_limit integer default 20)
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
           null::text as ai_reason
    from public.user_push_subscriptions device
    join public.user_source_subscriptions source_sub
      on source_sub.user_id = device.user_id and source_sub.notifications_enabled
    join public.platform_notices notice on notice.source_id = source_sub.source_id
    join public.platform_sources source on source.id = notice.source_id and not source.external
    left join public.user_preferences pref on pref.user_id = device.user_id
  ), ai as (
    select device.id as device_id, device.user_id, device.endpoint, device.p256dh, device.auth_secret,
           notice.id as nid, notice.title, notice.url, notice.first_seen, null::timestamptz as changed_at,
           null::text as ckind, notice.deadline, source.name as source_name,
           '{}'::text[] as hits, '{}'::text[] as excluded_hits,
           greatest(device.created_at, byok.created_at) as since,
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
    union all
    select b.*, 'changed'::text, b.changed_at
    from base b
    where b.changed_at is not null and b.changed_at > b.since and b.changed_at >= now() - interval '7 days'
      and (cardinality(b.hits) > 0 or exists (
        select 1 from public.user_notice_states state
        where state.user_id = b.user_id and state.notice_id = b.nid and state.is_saved))
    union all
    select a.*, 'new_notice'::text, 'epoch'::timestamptz
    from ai a where a.first_seen > a.since and a.first_seen >= now() - interval '7 days'
  )
  select p.device_id, p.user_id, p.endpoint, p.p256dh, p.auth_secret, p.nid, p.title, p.url,
         case when p.k = 'changed' or p.ai_reason is not null then false
              else not (cardinality(p.hits) > 0 and cardinality(p.excluded_hits) = 0) end,
         p.k, p.marker, p.ckind, p.source_name, p.deadline, p.hits, p.ai_reason
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
