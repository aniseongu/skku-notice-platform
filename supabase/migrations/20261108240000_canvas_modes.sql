-- Original settings parity: per-device iCampus alert mode (off / daily summary / summary and reminders),
-- the daily summary time, and a readable name for each registered device.
alter table public.user_push_subscriptions
  add column canvas_mode text not null default 'reminders' check (canvas_mode in ('off', 'summary', 'reminders')),
  add column device_name text check (device_name is null or char_length(device_name) <= 60);

alter table public.user_canvas_tokens add column summary_time time not null default '21:00';
grant select (summary_time) on public.user_canvas_tokens to authenticated;
grant update (summary_time) on public.user_canvas_tokens to authenticated;
create policy "Users set their own summary time" on public.user_canvas_tokens
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Which kind of alert it is decides which devices receive it.
alter table public.user_canvas_alerts
  add column kind text not null default 'deadline' check (kind in ('summary', 'deadline', 'problem'));
