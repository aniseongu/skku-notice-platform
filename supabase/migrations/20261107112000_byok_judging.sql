-- Judging profile (same fields the original service sends to Gemini) and the pending list for the worker.
create table public.user_judge_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  year smallint check (year between 1 and 6),
  semester smallint check (semester in (1, 2)),
  enrolled_semester smallint check (enrolled_semester between 1 and 16),
  enrollment_status text check (enrollment_status in ('재학', '휴학', '졸업예정', '졸업')),
  military_service text check (military_service in ('복무 전', '복무 완료', '해당 없음')),
  updated_at timestamptz not null default now()
);
alter table public.user_judge_profiles enable row level security;
revoke all on public.user_judge_profiles from public, anon, authenticated;
grant select, insert, update, delete on public.user_judge_profiles to authenticated;
grant all on public.user_judge_profiles to service_role;
create policy "Users read own judge profile" on public.user_judge_profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users add own judge profile" on public.user_judge_profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own judge profile" on public.user_judge_profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own judge profile" on public.user_judge_profiles for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.user_byok_keys alter column model set default 'gemini-3.1-flash-lite';

-- External internship postings (the only ones the original service judges) that are ready for this user's judgment:
-- body fetched, recent, not judged yet, and image text ready (or 24 hours old, so one failed image cannot block forever).
create function public.list_byok_pending(p_user_id uuid, p_limit integer default 6)
returns table (notice_id text, title text, body text)
language sql stable security invoker set search_path = '' as $$
  select n.id, n.title,
         left(concat_ws(E'\n', n.body, (
           select string_agg(c.extracted_text, E'\n')
           from (select image.content_sha256, image.engine_version from public.platform_notice_images image
                 where image.notice_id = n.id and image.status = 'ready' order by image.image_url limit 3) ready
           join public.platform_ocr_cache c on c.content_sha256 = ready.content_sha256 and c.engine_version = ready.engine_version
         )), 8000)
  from public.platform_notices n
  join public.platform_sources s on s.id = n.source_id and s.external
  where n.fetched_at is not null
    and n.first_seen >= now() - interval '14 days'
    and not exists (select 1 from public.user_notice_judgments j where j.user_id = p_user_id and j.notice_id = n.id)
    and (jsonb_array_length(n.images) = 0
         or (select count(*) from public.platform_notice_images i where i.notice_id = n.id and i.status = 'ready')
              >= least(jsonb_array_length(n.images), 3)
         or n.fetched_at < now() - interval '24 hours')
  order by n.first_seen desc, n.id
  limit least(greatest(coalesce(p_limit, 6), 1), 6);
$$;
revoke all on function public.list_byok_pending(uuid, integer) from public, anon, authenticated;
grant execute on function public.list_byok_pending(uuid, integer) to service_role;
