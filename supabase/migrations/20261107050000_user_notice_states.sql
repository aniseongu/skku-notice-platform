-- User-specific saved/read state; public notice content remains separate.
create table public.user_notice_states (
  user_id uuid not null references auth.users(id) on delete cascade,
  notice_id text not null references public.platform_notices(id) on delete cascade,
  is_saved boolean not null default false,
  read_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, notice_id)
);
create index user_notice_states_saved_idx on public.user_notice_states (user_id, updated_at desc) where is_saved;
alter table public.user_notice_states enable row level security;
revoke all on public.user_notice_states from public, anon, authenticated;
grant select, insert, update, delete on public.user_notice_states to authenticated;
grant all on public.user_notice_states to service_role;
create policy "Users can read own notice state" on public.user_notice_states
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own notice state" on public.user_notice_states
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own notice state" on public.user_notice_states
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete own notice state" on public.user_notice_states
  for delete to authenticated using ((select auth.uid()) = user_id);
