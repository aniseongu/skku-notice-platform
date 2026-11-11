-- 졸업요건 판정이 사용자의 LLM 판정(소프트웨어 직무 여부와 이유)을 근거로 다시 쓴다. 같은 공고를 AI로 다시 읽지 않는다.
-- 1) 대기열 조회가 판정 결과와 이유를 함께 돌려주고, 입력 해시에도 넣어 판정이 바뀌면 다시 계산한다.
drop function if exists public.list_graduation_requests(integer);
create function public.list_graduation_requests(p_limit integer default 5)
returns table (user_id uuid, notice_id text, title text, body text, programs jsonb, admission_year smallint,
               university_3p_internship_selected boolean, input_hash text, judgment_verdict text, judgment_reason text)
language sql stable security invoker set search_path = '' as $$
  select a.user_id, a.notice_id, n.title, t.text,
         coalesce(p.programs, '[]'::jsonb), p.admission_year, p.university_3p_internship_selected,
         md5(concat_ws('|', n.title, t.text, p.programs::text, p.admission_year, p.university_3p_internship_selected, j.verdict)),
         j.verdict, j.reason
  from public.user_notice_graduation_assessments a
  join public.platform_notices n on n.id = a.notice_id
  left join public.user_profiles p on p.user_id = a.user_id
  left join public.user_notice_judgments j on j.user_id = a.user_id and j.notice_id = a.notice_id
  cross join lateral (select left(concat_ws(E'\n', n.body, (
           select string_agg(c.extracted_text, E'\n')
           from (select image.content_sha256, image.engine_version from public.platform_notice_images image
                 where image.notice_id = n.id and image.status = 'ready' order by image.image_url limit 3) ready
           join public.platform_ocr_cache c on c.content_sha256 = ready.content_sha256 and c.engine_version = ready.engine_version
         )), 8000) as text) t
  where a.status = 'PENDING'
  order by n.first_seen desc, a.requested_at
  limit least(greatest(coalesce(p_limit, 5), 1), 60);
$$;
revoke all on function public.list_graduation_requests(integer) from public, anon, authenticated;
grant execute on function public.list_graduation_requests(integer) to service_role;

-- 2) 판정 뒤에 LLM 판정이 새로 생긴 공고를 다시 대기로 돌린다(실행당 3개).
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
