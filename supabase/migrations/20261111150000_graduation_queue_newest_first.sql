-- 졸업요건 판정 대기열을 새 공지부터, 한 번에 더 많이 가져온다. 이전에는 요청한 순서(오래된 것부터) 10개씩이라
-- 밀린 대기열 뒤에 새 공지가 며칠씩 기다렸다. 반환 열과 권한은 그대로다.
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
  order by n.first_seen desc, a.requested_at
  limit least(greatest(coalesce(p_limit, 5), 1), 60);
$$;
revoke all on function public.list_graduation_requests(integer) from public, anon, authenticated;
grant execute on function public.list_graduation_requests(integer) to service_role;
