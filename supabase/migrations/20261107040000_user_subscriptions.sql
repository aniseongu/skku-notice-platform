-- Personal board selections are owned by each signed-in user.
create table public.user_source_subscriptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id text not null references public.platform_sources(id) on delete cascade,
  notifications_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (user_id, source_id)
);

alter table public.user_source_subscriptions enable row level security;
revoke all on public.user_source_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.user_source_subscriptions to authenticated;
grant all on public.user_source_subscriptions to service_role;

create policy "Users can read their subscriptions" on public.user_source_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert their subscriptions" on public.user_source_subscriptions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their subscriptions" on public.user_source_subscriptions
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their subscriptions" on public.user_source_subscriptions
  for delete to authenticated using ((select auth.uid()) = user_id);
