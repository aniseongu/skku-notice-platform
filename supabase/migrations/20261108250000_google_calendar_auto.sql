-- Automatic Google Calendar sync: the user's Google refresh token, encrypted like the Gemini key and the iCampus token.
-- Only the service role (Edge Function and worker) reads the ciphertext; the browser sees status columns of its own row.
-- The ciphertext is bound to "<user id>:gcal" so it cannot be moved to another user or table.
create table public.user_google_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ciphertext text not null check (length(ciphertext) between 40 and 2000),
  disabled_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 200),
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_google_tokens enable row level security;
revoke all on public.user_google_tokens from public, anon, authenticated;
grant select (user_id, disabled_at, last_error, last_run_at, created_at, updated_at) on public.user_google_tokens to authenticated;
grant delete on public.user_google_tokens to authenticated;
grant all on public.user_google_tokens to service_role;
create policy "Users read their own google sync status" on public.user_google_tokens
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users stop their own google sync" on public.user_google_tokens
  for delete to authenticated using ((select auth.uid()) = user_id);
