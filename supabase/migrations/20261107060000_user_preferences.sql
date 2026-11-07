-- Account preferences are private and independent from public notice content.
create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  keywords text[] not null default '{}',
  excluded_keywords text[] not null default '{}',
  updated_at timestamptz not null default now(),
  check (cardinality(keywords) <= 20 and octet_length(array_to_string(keywords, ',')) <= 2000),
  check (cardinality(excluded_keywords) <= 20 and octet_length(array_to_string(excluded_keywords, ',')) <= 2000)
);
alter table public.user_preferences enable row level security;
revoke all on public.user_preferences from public, anon, authenticated;
grant select, insert, update, delete on public.user_preferences to authenticated;
grant all on public.user_preferences to service_role;
create policy "Users read own preferences" on public.user_preferences for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own preferences" on public.user_preferences for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own preferences" on public.user_preferences for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own preferences" on public.user_preferences for delete to authenticated using ((select auth.uid()) = user_id);
