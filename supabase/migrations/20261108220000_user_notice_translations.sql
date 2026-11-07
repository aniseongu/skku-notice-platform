-- 번역은 각자의 키로 만들고 본인만 읽는다. 실패한 공지는 최대 두 번 시도한다.
create table public.user_notice_translations (
  user_id uuid not null references auth.users(id) on delete cascade,
  notice_id text not null references public.platform_notices(id) on delete cascade,
  title text,
  body text,
  model text not null,
  attempts integer not null default 0 check (attempts between 0 and 2),
  updated_at timestamptz not null default now(),
  primary key (user_id, notice_id)
);
alter table public.user_notice_translations enable row level security;
revoke all on public.user_notice_translations from public, anon, authenticated;
grant select on public.user_notice_translations to authenticated;
grant all on public.user_notice_translations to service_role;
create policy "Users read own translations" on public.user_notice_translations
  for select to authenticated using ((select auth.uid()) = user_id);

create function public.list_byok_pending_translation(p_user_id uuid, p_limit integer default 3)
returns table (notice_id text, title text, body text, attempts integer)
language sql stable security invoker set search_path = '' as $$
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
  order by n.first_seen desc, n.id
  limit least(greatest(coalesce(p_limit, 3), 1), 3);
$$;
revoke all on function public.list_byok_pending_translation(uuid, integer) from public, anon, authenticated;
grant execute on function public.list_byok_pending_translation(uuid, integer) to service_role;
