-- Optional per-user iCampus (Canvas) token. Same protection as the Gemini key: only the service role
-- (Edge Function and worker) reads the ciphertext, browsers only see status columns of their own row.
-- The ciphertext is bound to "<user id>:canvas" so it cannot be moved to another user or to the Gemini key table.
create table public.user_canvas_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ciphertext text not null check (length(ciphertext) between 40 and 2000),
  token_hint text not null check (token_hint ~ '^[A-Za-z0-9_~-]{4}$'),
  disabled_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 200),
  error_at timestamptz,
  last_ok_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_canvas_tokens enable row level security;
revoke all on public.user_canvas_tokens from public, anon, authenticated;
grant select (user_id, token_hint, disabled_at, last_error, error_at, last_ok_at, created_at, updated_at)
  on public.user_canvas_tokens to authenticated;
grant all on public.user_canvas_tokens to service_role;
create policy "Users read own canvas token status" on public.user_canvas_tokens
  for select to authenticated using ((select auth.uid()) = user_id);
