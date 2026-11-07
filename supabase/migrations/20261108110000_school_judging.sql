-- Gemini judgment of school notices. With the user's own key, a school notice that fits the student (relevant)
-- is announced normally even without a keyword match; keyword matches stay normal; the rest stay silent.
-- Before this change only external internship postings were judged.
create function public.list_byok_pending_school(p_user_id uuid, p_limit integer default 6)
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
  join public.user_source_subscriptions sub on sub.user_id = k.user_id and sub.notifications_enabled
  join public.platform_notices n on n.source_id = sub.source_id
  join public.platform_sources s on s.id = n.source_id and not s.external
  where k.user_id = p_user_id and k.disabled_at is null
    and n.first_seen >= greatest(k.created_at, now() - interval '3 days')
    and (n.fetched_at is not null or n.first_seen < now() - interval '20 minutes')
    and not exists (select 1 from public.user_notice_judgments j where j.user_id = p_user_id and j.notice_id = n.id)
    and (jsonb_array_length(n.images) = 0
         or (select count(*) from public.platform_notice_images i where i.notice_id = n.id and i.status = 'ready')
              >= least(jsonb_array_length(n.images), 3)
         or n.first_seen < now() - interval '2 hours')
  order by n.first_seen desc, n.id
  limit least(greatest(coalesce(p_limit, 6), 1), 6);
$$;
revoke all on function public.list_byok_pending_school(uuid, integer) from public, anon, authenticated;
grant execute on function public.list_byok_pending_school(uuid, integer) to service_role;

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
      -- A user with a Gemini key waits up to 30 minutes for the school-notice judgment unless a keyword already matched.
      and (cardinality(b.hits) > 0 or not b.has_key or b.verdict is not null
           or b.first_seen < now() - interval '30 minutes')
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
