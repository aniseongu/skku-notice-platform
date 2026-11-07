-- Return only eligible recent notices; the worker alone can read device capabilities.
create function public.list_notice_push_candidates(p_limit integer default 20)
returns table (
  subscription_id uuid, user_id uuid, endpoint text, p256dh text, auth_secret text,
  notice_id text, title text, url text
) language sql stable security invoker set search_path = '' as $$
  select device.id, device.user_id, device.endpoint, device.p256dh, device.auth_secret,
         notice.id, notice.title, notice.url
  from public.user_push_subscriptions device
  join public.user_source_subscriptions source_sub
    on source_sub.user_id = device.user_id and source_sub.notifications_enabled
  join public.platform_notices notice on notice.source_id = source_sub.source_id
    and notice.first_seen > greatest(device.created_at, source_sub.created_at)
    and notice.first_seen >= now() - interval '7 days'
  left join public.user_preferences pref on pref.user_id = device.user_id
  left join public.user_notification_history history
    on history.subscription_id = device.id and history.notice_id = notice.id and history.kind = 'new_notice'
  where (history.id is null or (history.status in ('pending', 'failed')
         and history.updated_at < now() - interval '30 minutes' and history.attempt_count < 3))
    and (coalesce(cardinality(pref.keywords), 0) = 0 or exists (
      select 1 from unnest(pref.keywords) word
      where btrim(word) <> '' and (
        strpos(lower(notice.title || ' ' || coalesce(notice.body, '')), lower(btrim(word))) > 0
        or exists (select 1 from public.platform_notice_images image
          join public.platform_ocr_cache cache on cache.content_sha256 = image.content_sha256
            and cache.engine_version = image.engine_version
          where image.notice_id = notice.id and image.status = 'ready'
            and notice.images ? image.image_url
            and strpos(lower(cache.extracted_text), lower(btrim(word))) > 0)
      )
    ))
    and not exists (
      select 1 from unnest(coalesce(pref.excluded_keywords, '{}'::text[])) word
      where btrim(word) <> '' and (
        strpos(lower(notice.title || ' ' || coalesce(notice.body, '')), lower(btrim(word))) > 0
        or exists (select 1 from public.platform_notice_images image
          join public.platform_ocr_cache cache on cache.content_sha256 = image.content_sha256
            and cache.engine_version = image.engine_version
          where image.notice_id = notice.id and image.status = 'ready'
            and notice.images ? image.image_url
            and strpos(lower(cache.extracted_text), lower(btrim(word))) > 0)
      )
    )
  order by notice.first_seen, device.id, notice.id
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;
revoke all on function public.list_notice_push_candidates(integer) from public, anon, authenticated;
grant execute on function public.list_notice_push_candidates(integer) to service_role;
