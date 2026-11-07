-- Which Google calendar ("성대 공지") the app created for this user. A calendar id is not a secret.
-- The Google access token itself is never stored: it is used once in the browser, right after the user allows access.
create table public.user_calendar (
  user_id uuid primary key references auth.users(id) on delete cascade,
  calendar_id text not null check (calendar_id ~ '^[A-Za-z0-9._@%-]{5,200}$'),
  synced_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.user_calendar enable row level security;
revoke all on public.user_calendar from public, anon, authenticated;
grant select, insert, update, delete on public.user_calendar to authenticated;
grant all on public.user_calendar to service_role;
create policy "Users manage their own calendar link" on public.user_calendar
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
