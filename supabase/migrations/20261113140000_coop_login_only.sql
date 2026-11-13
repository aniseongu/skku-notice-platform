-- 현장실습(톨게이트) 공지와 로그인 전용 읽기 (2026-11-13).
--  1) platform_sources.coop, platform_notices.expires_at 추가, 현장실습 출처 행 등록.
--  2) 공지 표 4개(출처, 공지, 그림 글자 캐시, 그림 상태)는 로그인한 사용자만 읽는다(anon 읽기 제거).
--  3) 정리 함수가 expires_at이 지난 공지를 지운다(저장한 사용자가 있어도). 현장실습은 보관 기준(마감 30일 뒤)이 아니라 expires_at만 따른다.
--     지운 번호는 기록하지 않는다(가져오기 스크립트가 다시 올리면 들어올 수 있게). 일반 정리는 현장실습 공지를 건드리지 않는다.
--  4) 새 공지 알림 후보에서 현장실습을 뺀다.
-- 멱등이다.

alter table public.platform_sources add column if not exists coop boolean not null default false;
alter table public.platform_notices add column if not exists expires_at timestamptz;
create index if not exists platform_notices_expires_idx on public.platform_notices (expires_at) where expires_at is not null;

insert into public.platform_sources (id, name, url, external, coop)
values ('skku-coop', '현장실습', 'https://tollgate.skku.edu/student/manage/search/index.do', true, true)
on conflict (id) do update set name = excluded.name, url = excluded.url, external = true, coop = true;

-- 로그인한 사용자만 읽는다. service_role은 RLS를 건너뛰므로 서버 워커에는 영향이 없다.
revoke select on public.platform_sources, public.platform_notices,
  public.platform_ocr_cache, public.platform_notice_images from anon;
drop policy if exists "Public can read school sources" on public.platform_sources;
drop policy if exists "Public can read school notices" on public.platform_notices;
drop policy if exists "Public can read OCR cache" on public.platform_ocr_cache;
drop policy if exists "Public can read notice image state" on public.platform_notice_images;
drop policy if exists "Signed-in can read sources" on public.platform_sources;
drop policy if exists "Signed-in can read notices" on public.platform_notices;
drop policy if exists "Signed-in can read OCR cache" on public.platform_ocr_cache;
drop policy if exists "Signed-in can read notice image state" on public.platform_notice_images;
create policy "Signed-in can read sources" on public.platform_sources for select to authenticated using (true);
create policy "Signed-in can read notices" on public.platform_notices for select to authenticated using (true);
create policy "Signed-in can read OCR cache" on public.platform_ocr_cache for select to authenticated using (true);
create policy "Signed-in can read notice image state" on public.platform_notice_images for select to authenticated using (true);

create or replace function public.purge_expired_data(
  p_closed_days integer default 30, p_stale_days integer default 90, p_limit integer default 500
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  gone text[];
  notices integer := 0;
  coop integer := 0;
  ocr integer := 0;
  alerts integer := 0;
  marks integer := 0;
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
  return jsonb_build_object('notices', notices, 'expired', coop, 'ocr_cache', ocr, 'canvas_alerts', alerts, 'old_tombstones', marks);
end $$;
revoke all on function public.purge_expired_data(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.purge_expired_data(integer, integer, integer) to service_role;

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

-- 현장실습은 jidSeq마다 다른 공고다. 같은 기관이 부서·기간만 바꿔 같은 제목으로 여러 건 올리므로
-- 사본(중복 공지) 판별에서 뺀다. 아래는 20261112130000의 정의에 현장실습 분기만 더한 것이다.
create or replace function public.set_notice_dup_key() returns trigger
language plpgsql set search_path to '' as $$
declare t text; ext boolean; is_coop boolean; pre text; flat text; ocr text; flat_ocr text;
begin
  select coalesce(s.external, false), coalesce(s.coop, false) into ext, is_coop from public.platform_sources s where s.id = new.source_id;
  if coalesce(is_coop, false) then
    new.dup_key := null;
    new.dup_text_key := null;
    return new;
  end if;
  t := regexp_replace(lower(coalesce(new.title, '')), '[^0-9a-z가-힣]+', '', 'g');
  pre := case when coalesce(ext, false) then 'x:' else 's:' end;
  flat := regexp_replace(coalesce(new.body, ''), '\s+', '', 'g');
  new.dup_key := case when length(t) >= 8 then pre || t else null end;
  new.dup_text_key := null;
  if length(flat) >= 40 then
    new.dup_text_key := pre || 'b' || md5(left(flat, 400));
  else
    select string_agg(c.extracted_text, ' ' order by i.image_url) into ocr
      from (select * from public.platform_notice_images where notice_id = new.id and status = 'ready' order by image_url limit 3) i
      join public.platform_ocr_cache c on c.content_sha256 = i.content_sha256 and c.engine_version = i.engine_version;
    flat_ocr := regexp_replace(coalesce(ocr, ''), '\s+', '', 'g');
    if length(flat_ocr) >= 40 then new.dup_text_key := pre || 'o' || md5(left(flat_ocr, 400)); end if;
  end if;
  return new;
end $$;
