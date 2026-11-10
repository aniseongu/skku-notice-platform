-- 소프트웨어학과 인턴십 졸업요건·학교 신3품 인턴십 판정.
-- 사용자가 공지마다 "졸업요건 확인"을 누르면 PENDING 행이 생기고, OCI 워커가 판정 결과를 채운다.
-- 사용자는 결과 열을 직접 쓸 수 없다(열 단위 권한). 결과는 본인만 읽는다.

alter table public.user_profiles
  add column if not exists admission_year smallint check (admission_year between 2000 and 2100),
  add column if not exists university_3p_internship_selected boolean;

create table if not exists public.user_notice_graduation_assessments (
  user_id uuid not null references auth.users(id) on delete cascade,
  notice_id text not null references public.platform_notices(id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING', 'READY')),
  requested_at timestamptz not null default now(),
  -- 워커가 채우는 열
  input_hash text,
  ruleset_version text,
  extractor_version text,
  ai_status text check (ai_status in ('used', 'no_key', 'unavailable', 'limit')),
  model text,
  department jsonb,
  university_3p jsonb,
  facts jsonb,
  assessed_at timestamptz,
  primary key (user_id, notice_id)
);
alter table public.user_notice_graduation_assessments enable row level security;
revoke all on public.user_notice_graduation_assessments from public, anon, authenticated;
grant select, delete on public.user_notice_graduation_assessments to authenticated;
-- 사용자가 쓸 수 있는 열은 요청에 필요한 것뿐이다. 결과 열은 서비스 역할만 쓴다.
grant insert (user_id, notice_id, status, requested_at) on public.user_notice_graduation_assessments to authenticated;
grant update (status, requested_at) on public.user_notice_graduation_assessments to authenticated;
grant all on public.user_notice_graduation_assessments to service_role;

create policy "Users read own graduation assessments" on public.user_notice_graduation_assessments
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users request own graduation assessments" on public.user_notice_graduation_assessments
  for insert to authenticated with check ((select auth.uid()) = user_id and status = 'PENDING');
create policy "Users rerequest own graduation assessments" on public.user_notice_graduation_assessments
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id and status = 'PENDING');
create policy "Users delete own graduation assessments" on public.user_notice_graduation_assessments
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 워커용: 기다리는 요청과 공지 본문(이미지 글자 포함), 판정에 쓰는 프로필 열. 서비스 역할만 부른다.
create or replace function public.list_graduation_requests(p_limit integer default 5)
returns table (user_id uuid, notice_id text, title text, body text, programs jsonb, admission_year smallint,
               university_3p_internship_selected boolean, input_hash text)
language sql stable security invoker set search_path = '' as $$
  select a.user_id, a.notice_id, n.title,
         left(concat_ws(E'\n', n.body, (
           select string_agg(c.extracted_text, E'\n')
           from (select image.content_sha256, image.engine_version from public.platform_notice_images image
                 where image.notice_id = n.id and image.status = 'ready' order by image.image_url limit 3) ready
           join public.platform_ocr_cache c on c.content_sha256 = ready.content_sha256 and c.engine_version = ready.engine_version
         )), 8000) as body,
         coalesce(p.programs, '[]'::jsonb), p.admission_year, p.university_3p_internship_selected,
         md5(concat_ws('|', n.title, n.body, p.programs::text, p.admission_year, p.university_3p_internship_selected))
  from public.user_notice_graduation_assessments a
  join public.platform_notices n on n.id = a.notice_id
  left join public.user_profiles p on p.user_id = a.user_id
  where a.status = 'PENDING'
  order by a.requested_at
  limit least(greatest(coalesce(p_limit, 5), 1), 10);
$$;
revoke all on function public.list_graduation_requests(integer) from public, anon, authenticated;
grant execute on function public.list_graduation_requests(integer) to service_role;
