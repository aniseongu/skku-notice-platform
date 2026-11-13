-- 같은 공지의 사본끼리 AI 작업을 한 번만 한다(2026-11-13). 멱등이다.
-- 1) 번역과 졸업요건 대기열은 사본(먼저 감지된 같은 공지가 있는 글)을 건너뛴다. 판정 대기열은 이미 건너뛴다.
-- 2) reuse_duplicate_ai: 새 게시판을 구독해 더 먼저 감지된 사본이 대표가 되면, 사용자가 사본에 이미 가진 판정·번역·졸업요건을 대표에 복사해 AI를 다시 부르지 않게 한다.

CREATE OR REPLACE FUNCTION public.list_byok_pending_translation(p_user_id uuid, p_limit integer DEFAULT 3)
 RETURNS TABLE(notice_id text, title text, body text, attempts integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select n.id, n.title, n.body, coalesce(t.attempts, 0)
  from public.user_byok_keys k
  join public.platform_notices n on n.fetched_at is not null
  left join public.user_notice_translations t on t.user_id = k.user_id and t.notice_id = n.id
  cross join lateral (
    select n.title || E'\n' || left(coalesce(n.body, ''), 2000) as sample
  ) text_data
  cross join lateral (
    select length(regexp_replace(text_data.sample, '[^A-Za-z]', '', 'g')) as latin,
           length(regexp_replace(text_data.sample, '[^가-힣]', '', 'g')) as hangul
  ) letters
  where k.user_id = p_user_id and k.disabled_at is null
    and t.title is null and coalesce(t.attempts, 0) < 2
    and letters.latin >= 20 and letters.hangul < letters.latin * 0.15
    -- 같은 공지를 먼저 감지한 사본이 있으면 번역하지 않는다(대표 글 하나만)
    and not public.dup_loser(n.id, p_user_id)
  order by n.first_seen desc, n.id
  limit least(greatest(coalesce(p_limit, 3), 1), 3);
$function$;
revoke all on function public.list_byok_pending_translation(uuid, integer) from public, anon, authenticated;
grant execute on function public.list_byok_pending_translation(uuid, integer) to service_role;

CREATE OR REPLACE FUNCTION public.enqueue_graduation_assessments(p_limit integer DEFAULT 10)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  added integer := 0;
  requeued integer := 0;
begin
  with wanted as (
    select p.user_id, n.id as notice_id
    from public.user_profiles p
    join public.platform_notices n on n.first_seen > now() - interval '30 days'
    left join public.platform_sources s on s.id = n.source_id
    where p.onboarded_at is not null
      and public.is_graduation_candidate_notice(n.title, n.source_id, coalesce(s.external, false))
      and (n.deadline is null or n.deadline >= now())
      and (coalesce(s.external, false)
           or exists (select 1 from public.user_source_subscriptions sub where sub.user_id = p.user_id and sub.source_id = n.source_id))
      and (
        (p.programs->0->>'college' = '소프트웨어융합대학' and p.programs->0->>'department' = '소프트웨어학과'
          and p.dept_internship_done is not true)
        or (p.university_3p_internship_done is not true and p.university_3p_internship_selected is not false)
      )
      and not exists (select 1 from public.user_notice_graduation_assessments a
                      where a.user_id = p.user_id and a.notice_id = n.id)
      -- 같은 공지를 먼저 감지한 사본이 있으면 대기열에 넣지 않는다(대표 글 하나만)
      and not public.dup_loser(n.id, p.user_id)
    order by n.first_seen desc
    limit greatest(p_limit, 0)
  ), inserted as (
    insert into public.user_notice_graduation_assessments (user_id, notice_id, status)
    select user_id, notice_id, 'PENDING' from wanted
    on conflict do nothing
    returning 1
  )
  select count(*) into added from inserted;

  with stale as (
    select a.user_id, a.notice_id
    from public.user_notice_graduation_assessments a
    join public.user_profiles p on p.user_id = a.user_id
    left join public.user_byok_keys k on k.user_id = a.user_id and k.disabled_at is null
    where a.status = 'READY'
      and (exists (select 1 from public.platform_notices sn join public.platform_sources ss on ss.id = sn.source_id
                   where sn.id = a.notice_id and ss.external)
           or exists (select 1 from public.platform_notices sn join public.user_source_subscriptions sub
                      on sub.source_id = sn.source_id and sub.user_id = a.user_id where sn.id = a.notice_id))
      and (
        a.assessed_at < p.updated_at
        -- 판정한 뒤에 그림 글자(OCR)가 새로 나왔으면 그 글자까지 보고 다시 판정한다
        or exists (select 1 from public.platform_notice_images i
                   join public.platform_ocr_cache c on c.content_sha256 = i.content_sha256 and c.engine_version = i.engine_version
                   where i.notice_id = a.notice_id and i.status = 'ready' and c.processed_at > a.assessed_at)
        -- 판정한 뒤에 이 사용자의 LLM 판정이 새로 생겼으면(소프트웨어 직무가 아니라는 이유 등) 그 이유까지 보고 다시 판정한다
        or exists (select 1 from public.user_notice_judgments j
                   where j.user_id = a.user_id and j.notice_id = a.notice_id and j.created_at > a.assessed_at)
        or (a.ai_status in ('no_key', 'unavailable', 'limit') and k.user_id is not null
            and a.assessed_at < now() - interval '1 hour'
            and (k.used_on is distinct from current_date or k.used_today < 30))
      )
    order by a.assessed_at
    limit 3
  ), requeue as (
    update public.user_notice_graduation_assessments a
    set status = 'PENDING', requested_at = now()
    from stale s where a.user_id = s.user_id and a.notice_id = s.notice_id
    returning 1
  )
  select count(*) into requeued from requeue;

  return added + requeued;
end $function$;
revoke all on function public.enqueue_graduation_assessments(integer) from public, anon, authenticated;
grant execute on function public.enqueue_graduation_assessments(integer) to service_role;

create or replace function public.reuse_duplicate_ai(p_limit integer default 200) returns integer
language plpgsql security invoker set search_path to '' as $$
declare
  a integer := 0;
  b integer := 0;
  c integer := 0;
begin
  with src as (
    select t.user_id, o.id as to_id, t.verdict, t.reason, t.model, t.created_at, t.summary,
           t.deadline, t.deadline_kind, t.deadline_checked
    from public.user_notice_judgments t
    join public.platform_notices m on m.id = t.notice_id
    join public.platform_notices o on o.id <> m.id and o.source_id <> m.source_id
      and (o.dup_key = m.dup_key or o.dup_text_key = m.dup_text_key)
      and abs(o.posted_on - m.posted_on) <= 3 and (o.first_seen, o.id) < (m.first_seen, m.id)
    where (m.dup_key is not null or m.dup_text_key is not null)
      and (exists (select 1 from public.platform_sources os where os.id = o.source_id and os.external)
        or exists (select 1 from public.user_source_subscriptions us where us.user_id = t.user_id and us.source_id = o.source_id))
      and not public.dup_loser(o.id, t.user_id)
      and not exists (select 1 from public.user_notice_judgments x where x.user_id = t.user_id and x.notice_id = o.id)
    limit greatest(coalesce(p_limit, 200), 0)
  ), ins as (
    insert into public.user_notice_judgments (user_id, notice_id, verdict, reason, model, created_at, summary, deadline, deadline_kind, deadline_checked)
    select distinct on (user_id, to_id) user_id, to_id, verdict, reason, model, created_at, summary, deadline, deadline_kind, deadline_checked from src
    on conflict do nothing returning 1
  ) select count(*) into a from ins;

  with src as (
    select t.user_id, o.id as to_id, t.title, t.body, t.model, t.attempts, t.updated_at
    from public.user_notice_translations t
    join public.platform_notices m on m.id = t.notice_id
    join public.platform_notices o on o.id <> m.id and o.source_id <> m.source_id
      and (o.dup_key = m.dup_key or o.dup_text_key = m.dup_text_key)
      and abs(o.posted_on - m.posted_on) <= 3 and (o.first_seen, o.id) < (m.first_seen, m.id)
    where (m.dup_key is not null or m.dup_text_key is not null)
      and t.title is not null
      and (exists (select 1 from public.platform_sources os where os.id = o.source_id and os.external)
        or exists (select 1 from public.user_source_subscriptions us where us.user_id = t.user_id and us.source_id = o.source_id))
      and not public.dup_loser(o.id, t.user_id)
      and not exists (select 1 from public.user_notice_translations x where x.user_id = t.user_id and x.notice_id = o.id)
    limit greatest(coalesce(p_limit, 200), 0)
  ), ins as (
    insert into public.user_notice_translations (user_id, notice_id, title, body, model, attempts, updated_at)
    select distinct on (user_id, to_id) user_id, to_id, title, body, model, attempts, updated_at from src
    on conflict do nothing returning 1
  ) select count(*) into b from ins;

  with src as (
    select t.user_id, o.id as to_id, t.status, t.requested_at, t.input_hash, t.ruleset_version, t.extractor_version,
           t.ai_status, t.model, t.department, t.university_3p, t.facts, t.assessed_at
    from public.user_notice_graduation_assessments t
    join public.platform_notices m on m.id = t.notice_id
    join public.platform_notices o on o.id <> m.id and o.source_id <> m.source_id
      and (o.dup_key = m.dup_key or o.dup_text_key = m.dup_text_key)
      and abs(o.posted_on - m.posted_on) <= 3 and (o.first_seen, o.id) < (m.first_seen, m.id)
    where (m.dup_key is not null or m.dup_text_key is not null)
      and t.status = 'READY'
      and (exists (select 1 from public.platform_sources os where os.id = o.source_id and os.external)
        or exists (select 1 from public.user_source_subscriptions us where us.user_id = t.user_id and us.source_id = o.source_id))
      and not public.dup_loser(o.id, t.user_id)
      and not exists (select 1 from public.user_notice_graduation_assessments x where x.user_id = t.user_id and x.notice_id = o.id)
    limit greatest(coalesce(p_limit, 200), 0)
  ), ins as (
    insert into public.user_notice_graduation_assessments (user_id, notice_id, status, requested_at, input_hash, ruleset_version,
      extractor_version, ai_status, model, department, university_3p, facts, assessed_at)
    select distinct on (user_id, to_id) user_id, to_id, status, requested_at, input_hash, ruleset_version, extractor_version,
      ai_status, model, department, university_3p, facts, assessed_at from src
    on conflict do nothing returning 1
  ) select count(*) into c from ins;

  return a + b + c;
end $$;
revoke all on function public.reuse_duplicate_ai(integer) from public, anon, authenticated;
grant execute on function public.reuse_duplicate_ai(integer) to service_role;
