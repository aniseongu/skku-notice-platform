-- Update one field at a time so saving and reading cannot overwrite each other.
create function public.set_notice_saved(p_notice_id text, p_saved boolean)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null or p_saved is null then
    raise exception 'Authentication and saved state are required' using errcode = '42501';
  end if;
  insert into public.user_notice_states (user_id, notice_id, is_saved)
  values ((select auth.uid()), p_notice_id, p_saved)
  on conflict (user_id, notice_id) do update
    set is_saved = excluded.is_saved, updated_at = now();
end;
$$;

create function public.set_notice_read(p_notice_id text, p_read boolean)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null or p_read is null then
    raise exception 'Authentication and read state are required' using errcode = '42501';
  end if;
  insert into public.user_notice_states (user_id, notice_id, read_at)
  values ((select auth.uid()), p_notice_id, case when p_read then now() else null end)
  on conflict (user_id, notice_id) do update
    set read_at = excluded.read_at, updated_at = now();
end;
$$;
revoke all on function public.set_notice_saved(text, boolean) from public, anon;
revoke all on function public.set_notice_read(text, boolean) from public, anon;
grant execute on function public.set_notice_saved(text, boolean) to authenticated;
grant execute on function public.set_notice_read(text, boolean) to authenticated;
