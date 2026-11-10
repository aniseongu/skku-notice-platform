-- 졸업요건 판정을 버튼 없이 미리 해 둔다. 판정 워커가 10분마다 부른다(서비스 역할만).
-- 1) 아직 채우지 못한 요건이 있는 사용자에게 최근 30일 안의 인턴 공고마다 판정 대기 행을 만든다(실행당 p_limit개, 새 글 먼저).
-- 2) 프로필이 바뀌었거나, 키를 넣은 뒤 규칙으로만 판정했던 결과를 다시 대기로 돌린다(실행당 3개).
-- 졸업요건 판정 대상 공고: 외부 채용 소스는 모두. 학교 글은 인턴·현장실습 모집 공고만(회사 이름이 있는 글).
-- 서류 제출·인증 신청 절차·졸업 안내처럼 행정 안내는 인턴 공고가 아니라 제외한다. 웹의 isInternshipNotice와 같은 규칙이다.
create or replace function public.is_graduation_candidate_notice(p_title text, p_source_id text, p_external boolean)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select coalesce(p_external, false)
    or (
      (p_source_id = 'skku-career-intern' or p_title ~ '인턴|현장\s*실습')
      and p_title !~ '서류|제출|절차|인증|졸업|수료|설명회|결과|발표|지침|이수|교과목|학점\s*인정'
      and (p_source_id = 'skku-career-intern' or p_title ~ '㈜|\(주\)|주식회사|유한회사|재단법인|사단법인|\(재\)|\m(Inc|Corp|Co\.|Ltd)')
    );
$$;
revoke all on function public.is_graduation_candidate_notice(text, text, boolean) from public, anon, authenticated;
grant execute on function public.is_graduation_candidate_notice(text, text, boolean) to service_role;

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

-- 행정 안내 글에 이미 만들어 둔 판정은 지운다(보이지 않으므로 사용자 영향 없음).
delete from public.user_notice_graduation_assessments a using public.platform_notices n
  left join public.platform_sources s on s.id = n.source_id
  where a.notice_id = n.id and not public.is_graduation_candidate_notice(n.title, n.source_id, coalesce(s.external, false));

-- 판정 입력 해시에 그림에서 읽은 글을 넣는다: 그림 글자가 나중에 채워지면 다시 판정한다.
create or replace function public.list_graduation_requests(p_limit integer default 5)
returns table (user_id uuid, notice_id text, title text, body text, programs jsonb, admission_year smallint,
               university_3p_internship_selected boolean, input_hash text)
language sql stable security invoker set search_path = '' as $$
  select a.user_id, a.notice_id, n.title, t.text,
         coalesce(p.programs, '[]'::jsonb), p.admission_year, p.university_3p_internship_selected,
         md5(concat_ws('|', n.title, t.text, p.programs::text, p.admission_year, p.university_3p_internship_selected))
  from public.user_notice_graduation_assessments a
  join public.platform_notices n on n.id = a.notice_id
  left join public.user_profiles p on p.user_id = a.user_id
  cross join lateral (select left(concat_ws(E'\n', n.body, (
           select string_agg(c.extracted_text, E'\n')
           from (select image.content_sha256, image.engine_version from public.platform_notice_images image
                 where image.notice_id = n.id and image.status = 'ready' order by image.image_url limit 3) ready
           join public.platform_ocr_cache c on c.content_sha256 = ready.content_sha256 and c.engine_version = ready.engine_version
         )), 8000) as text) t
  where a.status = 'PENDING'
  order by a.requested_at
  limit least(greatest(coalesce(p_limit, 5), 1), 10);
$$;
revoke all on function public.list_graduation_requests(integer) from public, anon, authenticated;
grant execute on function public.list_graduation_requests(integer) to service_role;
