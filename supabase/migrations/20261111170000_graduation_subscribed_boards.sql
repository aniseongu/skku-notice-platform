-- 졸업요건 판정은 사용자가 받기로 고른 학교 게시판(또는 외부 인턴 공고)의 글만 대상으로 한다. 고르지 않은 게시판 글에는 AI 키를 쓰지 않는다.
create or replace function public.enqueue_graduation_assessments(p_limit integer default 10)
returns integer
language plpgsql security invoker set search_path = '' as $$
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
end $$;
revoke all on function public.enqueue_graduation_assessments(integer) from public, anon, authenticated;
grant execute on function public.enqueue_graduation_assessments(integer) to service_role;

-- 고르지 않은 게시판 글에 이미 대기 중인 판정(아직 처리 전)은 지운다. 끝난 판정은 사용자에게 보이지 않을 뿐이라 둔다.
delete from public.user_notice_graduation_assessments a using public.platform_notices n
  left join public.platform_sources s on s.id = n.source_id
  where a.status = 'PENDING' and a.notice_id = n.id and not coalesce(s.external, false)
    and not exists (select 1 from public.user_source_subscriptions sub where sub.user_id = a.user_id and sub.source_id = n.source_id);
