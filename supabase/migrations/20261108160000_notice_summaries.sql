-- Summaries a user asks for on demand with their own Gemini key (any notice, not only new ones the worker judged).
create table public.user_notice_summaries (
  user_id uuid not null references auth.users(id) on delete cascade,
  notice_id text not null references public.platform_notices(id) on delete cascade,
  summary text not null check (char_length(summary) between 1 and 400),
  model text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, notice_id)
);
alter table public.user_notice_summaries enable row level security;
revoke all on public.user_notice_summaries from public, anon, authenticated;
grant select on public.user_notice_summaries to authenticated;
grant all on public.user_notice_summaries to service_role;
create policy "Users read own summaries" on public.user_notice_summaries
  for select to authenticated using ((select auth.uid()) = user_id);

-- Title and text (body plus text read from up to three images) of one notice, for the Edge Function only.
create function public.notice_text_for_summary(p_notice_id text)
returns table (title text, body text)
language sql stable security invoker set search_path = '' as $$
  select n.title,
         left(concat_ws(E'\n', n.body, (
           select string_agg(c.extracted_text, E'\n')
           from (select image.content_sha256, image.engine_version from public.platform_notice_images image
                 where image.notice_id = n.id and image.status = 'ready' order by image.image_url limit 3) ready
           join public.platform_ocr_cache c on c.content_sha256 = ready.content_sha256 and c.engine_version = ready.engine_version
         )), 6000)
  from public.platform_notices n where n.id = p_notice_id;
$$;
revoke all on function public.notice_text_for_summary(text) from public, anon, authenticated;
grant execute on function public.notice_text_for_summary(text) to service_role;
