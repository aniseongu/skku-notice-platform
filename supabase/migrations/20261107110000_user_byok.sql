-- Optional per-user Gemini key (BYOK) and the user's own judgments of school internship notices.
-- The ciphertext is never readable by browsers: only the service role (Edge Function and worker) touches it.
create table public.user_byok_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ciphertext text not null check (length(ciphertext) between 40 and 2000),
  key_hint text not null check (key_hint ~ '^[A-Za-z0-9_-]{4}$'),
  model text not null default 'gemini-2.5-flash' check (model ~ '^[a-z0-9.-]{3,60}$'),
  disabled_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 200),
  error_at timestamptz,
  used_on date not null default current_date,
  used_today integer not null default 0 check (used_today >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_byok_keys enable row level security;
revoke all on public.user_byok_keys from public, anon, authenticated;
grant select (user_id, key_hint, model, disabled_at, last_error, error_at, used_on, used_today, created_at, updated_at)
  on public.user_byok_keys to authenticated;
grant all on public.user_byok_keys to service_role;
create policy "Users read own key status" on public.user_byok_keys
  for select to authenticated using ((select auth.uid()) = user_id);

create table public.user_notice_judgments (
  user_id uuid not null references auth.users(id) on delete cascade,
  notice_id text not null references public.platform_notices(id) on delete cascade,
  verdict text not null check (verdict in ('relevant', 'maybe', 'not_relevant')),
  reason text not null check (length(reason) <= 300),
  model text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, notice_id)
);
alter table public.user_notice_judgments enable row level security;
revoke all on public.user_notice_judgments from public, anon, authenticated;
grant select on public.user_notice_judgments to authenticated;
grant all on public.user_notice_judgments to service_role;
create policy "Users read own judgments" on public.user_notice_judgments
  for select to authenticated using ((select auth.uid()) = user_id);
