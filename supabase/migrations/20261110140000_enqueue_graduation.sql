-- 졸업요건 판정을 버튼 없이 미리 해 둔다. 판정 워커가 10분마다 부른다(서비스 역할만).
-- 1) 아직 채우지 못한 요건이 있는 사용자에게 최근 30일 안의 인턴 공고마다 판정 대기 행을 만든다(실행당 p_limit개, 새 글 먼저).
-- 2) 프로필이 바뀌었거나, 키를 넣은 뒤 규칙으로만 판정했던 결과를 다시 대기로 돌린다(실행당 3개).
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
      and (coalesce(s.external, false) or n.source_id = 'skku-career-intern' or n.title ~ '인턴|현장\s*실습')
      and (n.deadline is null or n.deadline >= now())
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
      and (
        a.assessed_at < p.updated_at
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
