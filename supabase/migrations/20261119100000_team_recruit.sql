-- 공고 연결형 팀원 모집. 표는 클라이언트가 직접 읽거나 쓰지 않고(RLS 켬, 정책 없음) security definer RPC로만 다룬다.
-- 읽기 RPC는 작성자·신청자 user_id를 돌려주지 않는다. 설계: docs/design/2026-11-19_team-recruit.md
create table if not exists public.team_posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  -- 공고 사본(FK 없음): 공고가 지워져도 팀 기록은 closes_at + 30일까지 남는다.
  notice_id text not null check (char_length(notice_id) between 1 and 200),
  notice_title text not null check (char_length(notice_title) between 1 and 200),
  notice_url text check (notice_url is null or (char_length(notice_url) <= 1000 and notice_url ~* '^https?://')),
  role text not null check (char_length(btrim(role)) between 1 and 40),
  capacity int not null check (capacity between 1 and 10),
  intro text not null check (char_length(btrim(intro)) between 1 and 200),
  contact text check (contact is null or (char_length(btrim(contact)) between 1 and 200 and contact !~* '^\s*(javascript|data|vbscript|file|blob):')),
  status text not null default 'open' check (status in ('open', 'closed')),
  closes_at timestamptz not null,
  hidden_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists team_posts_notice_idx on public.team_posts (notice_id) where deleted_at is null;
create index if not exists team_posts_owner_idx on public.team_posts (owner_id, created_at desc);
create unique index if not exists team_posts_one_live_per_notice on public.team_posts (owner_id, notice_id) where deleted_at is null;

create table if not exists public.team_applications (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.team_posts(id) on delete cascade,
  applicant_id uuid not null references auth.users(id) on delete cascade,
  anon_no int not null check (anon_no > 0),
  message text check (message is null or char_length(btrim(message)) between 1 and 100),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (post_id, applicant_id),
  unique (post_id, anon_no)
);
create index if not exists team_applications_applicant_idx on public.team_applications (applicant_id, status);

create table if not exists public.team_reports (
  post_id uuid not null references public.team_posts(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, reporter_id)
);

create table if not exists public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.team_actions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  at timestamptz not null default now()
);
create index if not exists team_actions_user_idx on public.team_actions (user_id, action, at desc);

alter table public.team_posts enable row level security;
alter table public.team_applications enable row level security;
alter table public.team_reports enable row level security;
alter table public.user_blocks enable row level security;
alter table public.team_actions enable row level security;
revoke all on public.team_posts, public.team_applications, public.team_reports, public.user_blocks, public.team_actions from public, anon, authenticated;
grant all on public.team_posts, public.team_applications, public.team_reports, public.user_blocks, public.team_actions to service_role;

-- 빈도 제한: 쓰기 동작은 분당 10회, 동작별 일 상한. 한도를 넘으면 기록하지 않고 거절한다.
create or replace function public.team_rate_check(p_user uuid, p_action text, p_day_limit int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('team_rate:' || p_user::text, 0));
  if (select count(*) from public.team_actions where user_id = p_user and at > now() - interval '1 minute') >= 10
     or (select count(*) from public.team_actions where user_id = p_user and action = p_action and at > now() - interval '1 day') >= p_day_limit then
    raise exception 'team_rate_limited' using errcode = 'P0001';
  end if;
  insert into public.team_actions(user_id, action) values (p_user, p_action);
end $$;

create or replace function public.team_uid() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'team_unauthenticated' using errcode = '28000'; end if;
  return u;
end $$;

-- 두 사용자 사이에 차단이 있는지(어느 방향이든).
create or replace function public.team_blocked(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_blocks
    where (blocker_id = p_a and blocked_id = p_b) or (blocker_id = p_b and blocked_id = p_a));
$$;

create or replace function public.team_create_post(p_notice_id text, p_role text, p_capacity int, p_intro text,
  p_closes_at timestamptz default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.team_uid(); n record; closes timestamptz; new_id uuid;
begin
  if p_role is null or char_length(btrim(p_role)) not between 1 and 40 or p_intro is null or char_length(btrim(p_intro)) not between 1 and 200
     or p_capacity is null or p_capacity not between 1 and 10 then
    raise exception 'team_invalid_input' using errcode = '22023';
  end if;
  perform public.team_rate_check(u, 'create', 5);
  perform pg_advisory_xact_lock(hashtextextended('team_posts:' || u::text, 0));
  -- 신고로 숨겨진 글을 지우고 다시 쓰는 회피를 막는다: 같은 공고에서 30일 안에 숨겨진 글이 있으면 거절.
  if exists (select 1 from public.team_posts where owner_id = u and notice_id = p_notice_id and hidden_at > now() - interval '30 days') then
    raise exception 'team_hidden_recently' using errcode = 'P0001';
  end if;
  select id, title, url, deadline into n from public.platform_notices where id = p_notice_id;
  if not found then raise exception 'team_notice_not_found' using errcode = 'P0001'; end if;
  if (select count(*) from public.team_posts where owner_id = u and deleted_at is null and status = 'open') >= 5 then
    raise exception 'team_limit_reached' using errcode = 'P0001';
  end if;
  -- 마감 기본값은 공고 마감. 공고 마감이 없거나 지났으면 30일 뒤. 최대 90일.
  closes := coalesce(p_closes_at, case when n.deadline > now() then n.deadline end, now() + interval '30 days');
  if closes <= now() or closes > now() + interval '90 days' then
    closes := least(greatest(closes, now() + interval '1 day'), now() + interval '90 days');
  end if;
  insert into public.team_posts(owner_id, notice_id, notice_title, notice_url, role, capacity, intro, closes_at)
  values (u, n.id, left(n.title, 200), n.url, btrim(p_role), p_capacity, btrim(p_intro), closes)
  returning id into new_id;
  return new_id;
exception when unique_violation then
  raise exception 'team_already_posted' using errcode = 'P0001';
end $$;

create or replace function public.team_set_contact(p_post_id uuid, p_contact text) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.team_uid();
begin
  if p_contact is not null and (char_length(btrim(p_contact)) > 200 or p_contact ~* '^\s*(javascript|data|vbscript|file|blob):') then
    raise exception 'team_invalid_input' using errcode = '22023';
  end if;
  perform public.team_rate_check(u, 'edit', 60);
  update public.team_posts set contact = nullif(btrim(p_contact), '')
    where id = p_post_id and owner_id = u and deleted_at is null;
  if not found then raise exception 'team_not_found' using errcode = 'P0001'; end if;
end $$;

create or replace function public.team_set_status(p_post_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.team_uid();
begin
  if p_status is null or p_status not in ('open', 'closed') then raise exception 'team_invalid_input' using errcode = '22023'; end if;
  perform public.team_rate_check(u, 'edit', 60);
  update public.team_posts set status = p_status where id = p_post_id and owner_id = u and deleted_at is null;
  if not found then raise exception 'team_not_found' using errcode = 'P0001'; end if;
end $$;

create or replace function public.team_delete_post(p_post_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.team_uid();
begin
  perform public.team_rate_check(u, 'edit', 60);
  update public.team_posts set deleted_at = now() where id = p_post_id and owner_id = u and deleted_at is null;
  if not found then raise exception 'team_not_found' using errcode = 'P0001'; end if;
end $$;

-- 공고별 팀 목록. user_id를 내보내지 않는다. 숨김·삭제·차단 관계의 글은 걸러 주고, 숨겨진 내 글은 hidden=true로 보여 준다.
create or replace function public.team_list_posts(p_notice_id text)
returns table (id uuid, role text, capacity int, approved_count int, intro text, state text,
  closes_at timestamptz, created_at timestamptz, mine boolean, hidden boolean, my_status text, my_application_id uuid)
language sql stable security definer set search_path = '' as $$
  select p.id, p.role, p.capacity,
    (select count(*)::int from public.team_applications a where a.post_id = p.id and a.status = 'approved'),
    p.intro,
    case when p.status = 'closed' or p.closes_at <= now() then 'closed'
         when (select count(*) from public.team_applications a where a.post_id = p.id and a.status = 'approved') >= p.capacity then 'full'
         else 'open' end,
    p.closes_at, p.created_at,
    p.owner_id = (select auth.uid()),
    p.hidden_at is not null and p.owner_id = (select auth.uid()),
    (select a.status from public.team_applications a where a.post_id = p.id and a.applicant_id = (select auth.uid())),
    (select a.id from public.team_applications a where a.post_id = p.id and a.applicant_id = (select auth.uid()))
  from public.team_posts p
  where (select auth.uid()) is not null and p.notice_id = p_notice_id and p.deleted_at is null
    and (p.hidden_at is null or p.owner_id = (select auth.uid()))
    and (p.owner_id = (select auth.uid()) or not public.team_blocked(p.owner_id, (select auth.uid())))
  order by p.created_at desc
  limit 50;
$$;

create or replace function public.team_apply(p_post_id uuid, p_message text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.team_uid(); p record; a record; next_no int; app_id uuid;
begin
  if p_message is not null and char_length(btrim(p_message)) > 100 then raise exception 'team_invalid_input' using errcode = '22023'; end if;
  perform public.team_rate_check(u, 'apply', 20);
  perform pg_advisory_xact_lock(hashtextextended('team_post:' || p_post_id::text, 0));
  select * into p from public.team_posts where id = p_post_id and deleted_at is null and hidden_at is null;
  if not found or p.status = 'closed' or p.closes_at <= now() then raise exception 'team_not_available' using errcode = 'P0001'; end if;
  if p.owner_id = u then raise exception 'team_own_post' using errcode = 'P0001'; end if;
  if public.team_blocked(p.owner_id, u) then raise exception 'team_not_available' using errcode = 'P0001'; end if;
  if (select count(*) from public.team_applications where post_id = p.id and status = 'approved') >= p.capacity then
    raise exception 'team_full' using errcode = 'P0001';
  end if;
  if (select count(*) from public.team_applications ap join public.team_posts tp on tp.id = ap.post_id
        where ap.applicant_id = u and ap.status in ('pending', 'approved') and tp.status = 'open' and tp.closes_at > now()) >= 20 then
    raise exception 'team_limit_reached' using errcode = 'P0001';
  end if;
  if (select count(*) from public.team_applications where post_id = p.id and status = 'pending') >= 30 then
    raise exception 'team_not_available' using errcode = 'P0001';
  end if;
  select * into a from public.team_applications where post_id = p.id and applicant_id = u;
  if found then
    if a.status in ('pending', 'approved') then raise exception 'team_already_applied' using errcode = 'P0001'; end if;
    if a.status = 'rejected' then raise exception 'team_rejected' using errcode = 'P0001'; end if;
    update public.team_applications set status = 'pending', message = nullif(btrim(p_message), ''), decided_at = null where id = a.id;
    return a.id;
  end if;
  select coalesce(max(anon_no), 0) + 1 into next_no from public.team_applications where post_id = p.id;
  insert into public.team_applications(post_id, applicant_id, anon_no, message)
  values (p.id, u, next_no, nullif(btrim(p_message), '')) returning id into app_id;
  return app_id;
end $$;

create or replace function public.team_withdraw(p_post_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.team_uid();
begin
  perform public.team_rate_check(u, 'edit', 60);
  perform pg_advisory_xact_lock(hashtextextended('team_post:' || p_post_id::text, 0));
  update public.team_applications set status = 'withdrawn', decided_at = now()
    where post_id = p_post_id and applicant_id = u and status in ('pending', 'approved');
  if not found then raise exception 'team_not_found' using errcode = 'P0001'; end if;
end $$;

-- 모집자만. 신청자는 익명 번호·한 줄·상태만 보이고 user_id는 없다.
create or replace function public.team_list_applicants(p_post_id uuid)
returns table (application_id uuid, anon_no int, message text, status text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, a.anon_no, a.message, a.status, a.created_at
  from public.team_applications a join public.team_posts p on p.id = a.post_id
  where p.id = p_post_id and p.owner_id = (select auth.uid()) and p.deleted_at is null
    and a.status <> 'withdrawn'
    and not public.team_blocked(p.owner_id, a.applicant_id)
  order by a.anon_no;
$$;

-- 승인·거절. 정원 검사는 글 단위 잠금 안에서 하므로 동시 승인이 정원을 넘지 못한다.
create or replace function public.team_decide(p_application_id uuid, p_decision text) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.team_uid(); a record; p record; n int;
begin
  if p_decision not in ('approved', 'rejected') then raise exception 'team_bad_decision' using errcode = 'P0001'; end if;
  perform public.team_rate_check(u, 'edit', 60);
  select post_id into a from public.team_applications where id = p_application_id;
  if not found then raise exception 'team_not_found' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('team_post:' || a.post_id::text, 0));
  select * into p from public.team_posts where id = a.post_id and owner_id = u and deleted_at is null;
  if not found then raise exception 'team_not_found' using errcode = 'P0001'; end if;
  select * into a from public.team_applications where id = p_application_id and status = 'pending';
  if not found then raise exception 'team_not_pending' using errcode = 'P0001'; end if;
  if public.team_blocked(p.owner_id, a.applicant_id) then raise exception 'team_not_found' using errcode = 'P0001'; end if;
  if p_decision = 'approved' then
    if p.contact is null then raise exception 'team_contact_required' using errcode = 'P0001'; end if;
    if (select count(*) from public.team_applications where post_id = p.id and status = 'approved') >= p.capacity then
      raise exception 'team_full' using errcode = 'P0001';
    end if;
  end if;
  update public.team_applications set status = p_decision, decided_at = now() where id = a.id and status = 'pending';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'team_not_pending' using errcode = 'P0001'; end if;
end $$;

-- 연락처는 모집자와 승인된 신청자만. 그 밖에는 null이 아니라 오류로 거절해 존재 여부도 알리지 않는다.
create or replace function public.team_get_contact(p_post_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := public.team_uid(); c text;
begin
  select p.contact into c from public.team_posts p
  where p.id = p_post_id and p.deleted_at is null
    and (p.owner_id = u or (exists (select 1 from public.team_applications a
      where a.post_id = p.id and a.applicant_id = u and a.status = 'approved')
      and not public.team_blocked(p.owner_id, u)));
  if not found then raise exception 'team_not_found' using errcode = 'P0001'; end if;
  return c;
end $$;

create or replace function public.team_report(p_post_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.team_uid(); p record;
begin
  perform public.team_rate_check(u, 'report', 20);
  select * into p from public.team_posts where id = p_post_id and deleted_at is null;
  if not found or p.owner_id = u then raise exception 'team_not_available' using errcode = 'P0001'; end if;
  insert into public.team_reports(post_id, reporter_id) values (p.id, u) on conflict do nothing;
  if (select count(*) from public.team_reports where post_id = p.id) >= 3 then
    update public.team_posts set hidden_at = coalesce(hidden_at, now()) where id = p.id;
  end if;
end $$;

-- 글 기준 차단: 상대 user_id를 모른 채 그 글(또는 신청)의 작성자를 차단한다.
create or replace function public.team_block_post_owner(p_post_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.team_uid(); o uuid;
begin
  perform public.team_rate_check(u, 'edit', 60);
  select owner_id into o from public.team_posts where id = p_post_id and deleted_at is null;
  if not found or o = u then raise exception 'team_not_available' using errcode = 'P0001'; end if;
  insert into public.user_blocks(blocker_id, blocked_id) values (u, o) on conflict do nothing;
  -- 차단하면 그 모집자 글들의 내 신청도 접근이 끊기도록 취소 처리한다.
  update public.team_applications set status = 'withdrawn', decided_at = now()
    where applicant_id = u and status in ('pending', 'approved')
      and post_id in (select id from public.team_posts where owner_id = o);
end $$;

create or replace function public.team_block_applicant(p_application_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.team_uid(); t uuid;
begin
  perform public.team_rate_check(u, 'edit', 60);
  select a.applicant_id into t from public.team_applications a join public.team_posts p on p.id = a.post_id
    where a.id = p_application_id and p.owner_id = u;
  if not found then raise exception 'team_not_found' using errcode = 'P0001'; end if;
  insert into public.user_blocks(blocker_id, blocked_id) values (u, t) on conflict do nothing;
  update public.team_applications set status = 'rejected', decided_at = now()
    where applicant_id = t and status in ('pending', 'approved')
      and post_id in (select id from public.team_posts where owner_id = u);
end $$;

create or replace function public.team_list_blocks() returns table (id uuid, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select b.id, b.created_at from public.user_blocks b where b.blocker_id = (select auth.uid()) order by b.created_at desc;
$$;

create or replace function public.team_unblock(p_block_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.team_uid();
begin
  delete from public.user_blocks where id = p_block_id and blocker_id = u;
end $$;

-- 내 모집과 내 신청(공고 사본 포함). 기회함에서 쓴다.
create or replace function public.team_my_activity()
returns table (kind text, post_id uuid, notice_id text, notice_title text, role text, status text, application_id uuid)
language sql stable security definer set search_path = '' as $$
  select 'owner'::text, p.id, p.notice_id, p.notice_title, p.role,
    case when p.hidden_at is not null then 'hidden' when p.status = 'closed' or p.closes_at <= now() then 'closed' else 'open' end,
    null::uuid
  from public.team_posts p where p.owner_id = (select auth.uid()) and p.deleted_at is null
  union all
  select 'applicant', p.id, p.notice_id, p.notice_title, p.role, a.status, a.id
  from public.team_applications a join public.team_posts p on p.id = a.post_id
  where a.applicant_id = (select auth.uid()) and p.deleted_at is null and p.hidden_at is null
    and not public.team_blocked(p.owner_id, (select auth.uid()))
  order by 1, 2
  limit 100;
$$;

-- 만료 정리(service_role만): 마감 30일 지난 글, 삭제 7일 지난 글, 2일 지난 빈도 기록.
create or replace function public.team_purge_expired() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.team_posts where closes_at < now() - interval '30 days' or deleted_at < now() - interval '7 days';
  get diagnostics n = row_count;
  delete from public.team_actions where at < now() - interval '2 days';
  return n;
end $$;

revoke all on function public.team_rate_check(uuid, text, int), public.team_uid(), public.team_blocked(uuid, uuid) from public, anon, authenticated;
revoke all on function public.team_create_post(text, text, int, text, timestamptz), public.team_set_contact(uuid, text),
  public.team_set_status(uuid, text), public.team_delete_post(uuid), public.team_list_posts(text),
  public.team_apply(uuid, text), public.team_withdraw(uuid), public.team_list_applicants(uuid),
  public.team_decide(uuid, text), public.team_get_contact(uuid), public.team_report(uuid),
  public.team_block_post_owner(uuid), public.team_block_applicant(uuid), public.team_list_blocks(),
  public.team_unblock(uuid), public.team_my_activity(), public.team_purge_expired() from public, anon, authenticated;
grant execute on function public.team_create_post(text, text, int, text, timestamptz), public.team_set_contact(uuid, text),
  public.team_set_status(uuid, text), public.team_delete_post(uuid), public.team_list_posts(text),
  public.team_apply(uuid, text), public.team_withdraw(uuid), public.team_list_applicants(uuid),
  public.team_decide(uuid, text), public.team_get_contact(uuid), public.team_report(uuid),
  public.team_block_post_owner(uuid), public.team_block_applicant(uuid), public.team_list_blocks(),
  public.team_unblock(uuid), public.team_my_activity() to authenticated;
grant execute on function public.team_purge_expired() to service_role;
grant execute on function public.team_rate_check(uuid, text, int), public.team_uid(), public.team_blocked(uuid, uuid) to service_role;
