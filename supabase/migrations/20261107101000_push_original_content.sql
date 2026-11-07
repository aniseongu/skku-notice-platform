-- Match the original service's notification content and its "[수정]" change alerts.
-- Change alerts go only to notices that matter to the user (keyword match or saved), once per change.
alter table public.user_notification_history drop constraint user_notification_history_kind_check;
alter table public.user_notification_history add constraint user_notification_history_kind_check
  check (kind in ('new_notice', 'changed'));
alter table public.user_notification_history
  add column change_marker timestamptz not null default 'epoch';
alter table public.user_notification_history
  drop constraint user_notification_history_subscription_id_notice_id_kind_key;
alter table public.user_notification_history
  add constraint user_notification_history_device_notice_kind_change_key
  unique (subscription_id, notice_id, kind, change_marker);

create function public.notice_matched_words(p_notice_id text, p_title text, p_body text, p_words text[])
returns text[] language sql stable security invoker set search_path = '' as $$
  select coalesce(array_agg(distinct btrim(word) order by btrim(word)), '{}'::text[])
  from unnest(coalesce(p_words, '{}'::text[])) word
  where btrim(word) <> '' and (
    strpos(lower(p_title || ' ' || coalesce(p_body, '')), lower(btrim(word))) > 0
    or exists (select 1 from public.platform_notice_images image
      join public.platform_ocr_cache cache on cache.content_sha256 = image.content_sha256
        and cache.engine_version = image.engine_version
      where image.notice_id = p_notice_id and image.status = 'ready'
        and exists (select 1 from public.platform_notices n where n.id = p_notice_id and n.images ? image.image_url)
        and strpos(lower(cache.extracted_text), lower(btrim(word))) > 0)
  );
$$;
revoke all on function public.notice_matched_words(text, text, text, text[]) from public, anon, authenticated;
grant execute on function public.notice_matched_words(text, text, text, text[]) to service_role;

drop function public.claim_notice_push(uuid, uuid, text);
create function public.claim_notice_push(
  p_user_id uuid, p_subscription_id uuid, p_notice_id text,
  p_kind text default 'new_notice', p_change_marker timestamptz default 'epoch')
returns bigint language plpgsql security invoker set search_path = '' as $$
declare claimed_id bigint;
begin
  insert into public.user_notification_history (user_id, subscription_id, notice_id, kind, change_marker, status)
  values (p_user_id, p_subscription_id, p_notice_id, p_kind, p_change_marker, 'pending')
  on conflict (subscription_id, notice_id, kind, change_marker) do update
    set status = 'pending', attempt_count = public.user_notification_history.attempt_count + 1, updated_at = now()
    where public.user_notification_history.user_id = excluded.user_id
      and public.user_notification_history.status in ('failed', 'pending')
      and public.user_notification_history.updated_at < now() - interval '30 minutes'
      and public.user_notification_history.attempt_count < 3
  returning id into claimed_id;
  return claimed_id;
end;
$$;
revoke all on function public.claim_notice_push(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_notice_push(uuid, uuid, text, text, timestamptz) to service_role;

drop function public.list_notice_push_candidates(integer);
create function public.list_notice_push_candidates(p_limit integer default 20)
returns table (
  subscription_id uuid, user_id uuid, endpoint text, p256dh text, auth_secret text,
  notice_id text, title text, url text, silent boolean,
  kind text, change_marker timestamptz, change_kind text,
  source_name text, deadline timestamptz, matched_words text[]
) language sql stable security invoker set search_path = '' as $$
  with base as (
    select device.id as device_id, device.user_id, device.endpoint, device.p256dh, device.auth_secret,
           notice.id as nid, notice.title, notice.url, notice.first_seen, notice.changed_at, notice.change_kind as ckind,
           notice.deadline, source.name as source_name,
           public.notice_matched_words(notice.id, notice.title, notice.body, pref.keywords) as hits,
           public.notice_matched_words(notice.id, notice.title, notice.body, pref.excluded_keywords) as excluded_hits,
           greatest(device.created_at, source_sub.created_at) as since
    from public.user_push_subscriptions device
    join public.user_source_subscriptions source_sub
      on source_sub.user_id = device.user_id and source_sub.notifications_enabled
    join public.platform_notices notice on notice.source_id = source_sub.source_id
    join public.platform_sources source on source.id = notice.source_id
    left join public.user_preferences pref on pref.user_id = device.user_id
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
  )
  select p.device_id, p.user_id, p.endpoint, p.p256dh, p.auth_secret, p.nid, p.title, p.url,
         case when p.k = 'changed' then false
              else not (cardinality(p.hits) > 0 and cardinality(p.excluded_hits) = 0) end,
         p.k, p.marker, p.ckind, p.source_name, p.deadline, p.hits
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
