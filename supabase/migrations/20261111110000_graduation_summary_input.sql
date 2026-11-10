-- 졸업요건 판정의 입력에 사용자 자신의 Gemini가 만든 요약과 판정 이유를 더한다.
-- 공고 본문·그림 글자(OCR)가 잡음이 많거나 회사 이름·기간이 그림에만 있을 때, 요약("넷마블네오에서 …5개월간 진행")이 가장 깨끗한 문장이다.
-- 요약은 본인 것만 읽는다(user_id로 묶는다). 요약이나 판정이 판정보다 늦게 생기면 다시 판정한다.
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
  left join public.user_notice_judgments j on j.user_id = a.user_id and j.notice_id = a.notice_id
  left join public.user_notice_summaries sm on sm.user_id = a.user_id and sm.notice_id = a.notice_id
  cross join lateral (select left(concat_ws(E'\n', n.body,
           case when coalesce(sm.summary, j.summary) is not null then '요약: ' || coalesce(sm.summary, j.summary) end,
           (select string_agg(c.extracted_text, E'\n')
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

-- 판정한 뒤에 요약이 새로 생겼으면 그 요약까지 보고 다시 판정한다(실행당 3개는 기존 제한 안에서 함께 센다).
create or replace function public.requeue_graduation_after_summary(p_limit integer default 3)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  with stale as (
    select a.user_id, a.notice_id
    from public.user_notice_graduation_assessments a
    left join public.user_notice_summaries sm on sm.user_id = a.user_id and sm.notice_id = a.notice_id
    left join public.user_notice_judgments j on j.user_id = a.user_id and j.notice_id = a.notice_id
    where a.status = 'READY'
      and (sm.created_at > a.assessed_at or (j.summary is not null and j.created_at > a.assessed_at))
    order by a.assessed_at
    limit greatest(p_limit, 0)
  ), requeue as (
    update public.user_notice_graduation_assessments a
    set status = 'PENDING', requested_at = now()
    from stale s where a.user_id = s.user_id and a.notice_id = s.notice_id
    returning 1
  )
  select count(*) into n from requeue;
  return n;
end $$;
revoke all on function public.requeue_graduation_after_summary(integer) from public, anon, authenticated;
grant execute on function public.requeue_graduation_after_summary(integer) to service_role;
