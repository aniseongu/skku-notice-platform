-- iCampus (Canvas) worker: per-user run state and a queue of alerts the push worker delivers.
-- The worker that decrypts tokens never holds the push keys; it only writes alerts into this queue.
alter table public.user_canvas_tokens
  add column state jsonb not null default '{}'::jsonb,
  add column last_run_at timestamptz,
  add column last_reason text check (last_reason is null or length(last_reason) <= 300);
-- Browsers may read their own run time and the plain reason a check was incomplete; state stays server-only.
grant select (last_run_at, last_reason) on public.user_canvas_tokens to authenticated;

create table public.user_canvas_alerts (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 180),
  body text not null check (length(body) <= 600),
  url text not null check (url like 'https://canvas.skku.edu/%'),
  priority text not null default 'default' check (priority in ('default', 'high')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index user_canvas_alerts_pending on public.user_canvas_alerts (status, created_at);
alter table public.user_canvas_alerts enable row level security;
revoke all on public.user_canvas_alerts from public, anon, authenticated;
grant all on public.user_canvas_alerts to service_role;
grant usage, select on sequence public.user_canvas_alerts_id_seq to service_role;
