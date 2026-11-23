begin;

create or replace function public.moderation_set_hidden(p_kind text, p_post_id uuid, p_hidden boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare previous_hidden_at timestamptz;
begin
  if p_kind is null or p_kind not in ('question', 'answer', 'experience', 'team')
     or p_post_id is null or p_hidden is null then
    raise exception 'moderation_invalid_input' using errcode = '22023';
  end if;

  if p_kind = 'team' then
    select hidden_at into previous_hidden_at from public.team_posts
      where id = p_post_id and deleted_at is null for no key update;
  else
    select hidden_at into previous_hidden_at from public.qe_posts
      where id = p_post_id and deleted_at is null
        and kind = case when p_kind = 'answer' then 'question' else p_kind end
        and (parent_id is not null) = (p_kind = 'answer')
      for no key update;
  end if;
  if not found then
    raise exception 'moderation_post_not_found' using errcode = 'P0001';
  end if;

  -- Repeated commands preserve the original hide time and reports on already visible posts.
  if p_hidden = (previous_hidden_at is not null) then return; end if;

  if p_kind = 'team' then
    if not p_hidden then delete from public.team_reports where post_id = p_post_id; end if;
    update public.team_posts set hidden_at = case when p_hidden then now() end where id = p_post_id;
  else
    if not p_hidden then delete from public.qe_reports where post_id = p_post_id; end if;
    update public.qe_posts set hidden_at = case when p_hidden then now() end where id = p_post_id;
  end if;
end $$;

revoke all on function public.moderation_set_hidden(text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.moderation_set_hidden(text, uuid, boolean) to service_role;

-- Take the same row lock as moderation before adding or counting team reports.
create or replace function public.team_report(p_post_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.team_uid(); p record;
begin
  perform public.team_rate_check(u, 'report', 20);
  select * into p from public.team_posts where id = p_post_id and deleted_at is null for no key update;
  if not found or p.owner_id = u then raise exception 'team_not_available' using errcode = 'P0001'; end if;
  insert into public.team_reports(post_id, reporter_id) values (p.id, u) on conflict do nothing;
  if (select count(*) from public.team_reports where post_id = p.id) >= 3 then
    update public.team_posts set hidden_at = coalesce(hidden_at, now()) where id = p.id;
  end if;
end $$;

commit;
