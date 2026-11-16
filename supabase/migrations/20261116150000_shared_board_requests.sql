-- User requests remain private; only verified public board metadata is shared.
alter table public.platform_sources add column if not exists shared_board boolean not null default false;

create table public.shared_board_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  url text not null check (char_length(url) <= 400),
  status text not null default 'pending' check (status in ('pending', 'added', 'review', 'failed')),
  source_id text references public.platform_sources(id),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.shared_board_requests enable row level security;
revoke all on public.shared_board_requests from public, anon, authenticated;
grant select on public.shared_board_requests to authenticated;
grant insert (name, url) on public.shared_board_requests to authenticated;
grant all on public.shared_board_requests to service_role;
create policy "Users read their board requests" on public.shared_board_requests
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users create their board requests" on public.shared_board_requests
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- The browser supplies its expected account so a session change between
-- checking the session and sending cannot submit on the new account's behalf.
create function public.submit_shared_board(expected_user uuid, request_name text, request_url text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare request_id uuid;
begin
  if auth.uid() is null or auth.uid() <> expected_user then
    raise exception 'account_changed' using errcode = 'P0001';
  end if;
  insert into public.shared_board_requests (name, url) values (request_name, request_url) returning id into request_id;
  return request_id;
end $$;
revoke all on function public.submit_shared_board(uuid, text, text) from public, anon;
grant execute on function public.submit_shared_board(uuid, text, text) to authenticated;

create function public.shared_board_request_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('shared_board:' || new.user_id::text, 0));
  if (select count(*) from public.shared_board_requests
      where user_id = new.user_id and created_at > now() - interval '1 day') >= 5 then
    raise exception 'board_request_limit' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.shared_board_request_limit() from public, anon, authenticated;
create trigger shared_board_request_limit before insert on public.shared_board_requests
  for each row execute function public.shared_board_request_limit();

-- Only the worker may publish a validated board. Keep publication and the
-- requester's subscription in one transaction even when two requests race.
create function public.publish_shared_board(request_id uuid, canonical_url text, initial_notices jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare request_row public.shared_board_requests%rowtype; source text;
begin
  select * into request_row from public.shared_board_requests where id = request_id for update;
  if not found or request_row.status <> 'pending' then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('shared_board_url:' || canonical_url, 0));
  select id into source from public.platform_sources where url = canonical_url and not external;
  if source is null then
    -- Bound total automatic work on the 1 GB worker; overflow goes to the
    -- existing developer request queue instead of silently increasing load.
    perform pg_advisory_xact_lock(hashtextextended('shared_board_capacity', 0));
    if (select count(*) from public.platform_sources where shared_board) >= 50 then
      perform public.request_shared_board_review(request_id);
      return null;
    end if;
    source := 'shared-' || replace(request_row.id::text, '-', '');
    insert into public.platform_sources (id, name, url, shared_board)
      values (source, btrim(request_row.name), canonical_url, true);
    -- Baseline notices and the subscription share a transaction timestamp.
    -- Push candidates require first_seen > subscription.created_at.
    insert into public.platform_notices
      (id, source_id, article_no, title, category, url, posted_on, pinned, first_seen)
    select source || '/' || n.article_no, source, n.article_no, n.title, n.category,
           n.url, n.posted_on, n.pinned, now()
    from jsonb_to_recordset(initial_notices) as n(
      article_no text, title text, category text, url text, posted_on date, pinned boolean
    ) on conflict (id) do nothing;
  end if;
  insert into public.user_source_subscriptions (user_id, source_id)
    values (request_row.user_id, source) on conflict (user_id, source_id) do nothing;
  update public.shared_board_requests set status = 'added', source_id = source, processed_at = now()
    where id = request_row.id;
  return source;
end $$;
revoke all on function public.publish_shared_board(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.publish_shared_board(uuid, text, jsonb) to service_role;

create function public.request_shared_board_review(request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare request_row public.shared_board_requests%rowtype;
begin
  select * into request_row from public.shared_board_requests where id = request_id for update;
  if not found or request_row.status <> 'pending' then return; end if;
  begin
    insert into public.user_feedback (user_id, kind, body)
      values (request_row.user_id, 'idea', '[게시판 추가 요청] 이름: ' || btrim(request_row.name)
        || ' / 주소: ' || request_row.url);
  exception when raise_exception then
    update public.shared_board_requests set status = 'failed', processed_at = now() where id = request_row.id;
    return;
  end;
  update public.shared_board_requests set status = 'review', processed_at = now()
    where id = request_row.id;
end $$;
revoke all on function public.request_shared_board_review(uuid) from public, anon, authenticated;
grant execute on function public.request_shared_board_review(uuid) to service_role;
