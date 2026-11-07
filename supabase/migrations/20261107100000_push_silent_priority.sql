-- Match the original service: every new notice of a subscribed board is delivered;
-- notices that do not match the user's interest keywords arrive silently (priority "low").
create function public.notice_matches_words(p_notice_id text, p_title text, p_body text, p_words text[])
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from unnest(coalesce(p_words, '{}'::text[])) word
    where btrim(word) <> '' and (
      strpos(lower(p_title || ' ' || coalesce(p_body, '')), lower(btrim(word))) > 0
      or exists (select 1 from public.platform_notices notice
        join public.platform_notice_images image on image.notice_id = notice.id
        join public.platform_ocr_cache cache on cache.content_sha256 = image.content_sha256
          and cache.engine_version = image.engine_version
        where notice.id = p_notice_id and image.status = 'ready'
          and notice.images ? image.image_url
          and strpos(lower(cache.extracted_text), lower(btrim(word))) > 0)
    )
  );
$$;
revoke all on function public.notice_matches_words(text, text, text, text[]) from public, anon, authenticated;
grant execute on function public.notice_matches_words(text, text, text, text[]) to service_role;

drop function public.list_notice_push_candidates(integer);
create function public.list_notice_push_candidates(p_limit integer default 20)
returns table (
  subscription_id uuid, user_id uuid, endpoint text, p256dh text, auth_secret text,
  notice_id text, title text, url text, silent boolean
) language sql stable security invoker set search_path = '' as $$
  select device.id, device.user_id, device.endpoint, device.p256dh, device.auth_secret,
         notice.id, notice.title, notice.url,
         not (public.notice_matches_words(notice.id, notice.title, notice.body, pref.keywords)
              and not public.notice_matches_words(notice.id, notice.title, notice.body, pref.excluded_keywords)) as silent
  from public.user_push_subscriptions device
  join public.user_source_subscriptions source_sub
    on source_sub.user_id = device.user_id and source_sub.notifications_enabled
  join public.platform_notices notice on notice.source_id = source_sub.source_id
    and notice.first_seen > greatest(device.created_at, source_sub.created_at)
    and notice.first_seen >= now() - interval '7 days'
  left join public.user_preferences pref on pref.user_id = device.user_id
  left join public.user_notification_history history
    on history.subscription_id = device.id and history.notice_id = notice.id and history.kind = 'new_notice'
  where history.id is null or (history.status in ('pending', 'failed')
         and history.updated_at < now() - interval '30 minutes' and history.attempt_count < 3)
  order by notice.first_seen, device.id, notice.id
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;
revoke all on function public.list_notice_push_candidates(integer) from public, anon, authenticated;
grant execute on function public.list_notice_push_candidates(integer) to service_role;
