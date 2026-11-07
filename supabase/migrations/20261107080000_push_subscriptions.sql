-- Browser push endpoints are private capability URLs and belong to one user.
create table public.user_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check (octet_length(endpoint) <= 2048),
  check (endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com)/[^[:space:]]+$'),
  check (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  check (auth_secret ~ '^[A-Za-z0-9_-]{22}$')
);

create table public.user_notification_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null,
  notice_id text not null references public.platform_notices(id) on delete cascade,
  kind text not null check (kind in ('new_notice')),
  status text not null check (status in ('pending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (subscription_id, user_id) references public.user_push_subscriptions(id, user_id) on delete cascade,
  unique (subscription_id, notice_id, kind)
);

alter table public.user_push_subscriptions enable row level security;
alter table public.user_notification_history enable row level security;
revoke all on public.user_push_subscriptions, public.user_notification_history from public, anon, authenticated;
grant select, insert, update, delete on public.user_push_subscriptions to authenticated;
grant select on public.user_notification_history to authenticated;
grant all on public.user_push_subscriptions, public.user_notification_history to service_role;
grant usage, select on sequence public.user_notification_history_id_seq to service_role;
create policy "Users read own push subscriptions" on public.user_push_subscriptions for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users add own push subscriptions" on public.user_push_subscriptions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own push subscriptions" on public.user_push_subscriptions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own push subscriptions" on public.user_push_subscriptions for delete to authenticated using ((select auth.uid()) = user_id);
create policy "Users read own notification history" on public.user_notification_history for select to authenticated using ((select auth.uid()) = user_id);
