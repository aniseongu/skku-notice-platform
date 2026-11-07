-- Claiming a device/notice pair is atomic; only the worker can call this function.
alter table public.user_notification_history
  add column attempt_count integer not null default 1 check (attempt_count between 1 and 3);

create function public.claim_notice_push(p_user_id uuid, p_subscription_id uuid, p_notice_id text)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare claimed_id bigint;
begin
  insert into public.user_notification_history (user_id, subscription_id, notice_id, kind, status)
  values (p_user_id, p_subscription_id, p_notice_id, 'new_notice', 'pending')
  on conflict (subscription_id, notice_id, kind) do update
    set status = 'pending', attempt_count = public.user_notification_history.attempt_count + 1, updated_at = now()
    where public.user_notification_history.user_id = excluded.user_id
      and public.user_notification_history.status in ('failed', 'pending')
      and public.user_notification_history.updated_at < now() - interval '30 minutes'
      and public.user_notification_history.attempt_count < 3
  returning id into claimed_id;
  return claimed_id;
end;
$$;
revoke all on function public.claim_notice_push(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_notice_push(uuid, uuid, text) to service_role;
