-- 내 기회함: 사용자가 모아 둔 공지의 진행 상태와 메모. 공지가 지워져도 기록이 남도록 platform_notices에 FK를 걸지 않고 제목·링크·마감을 사본으로 둔다.
create table if not exists public.user_opportunities (
  user_id uuid not null references auth.users(id) on delete cascade,
  notice_id text not null check (char_length(notice_id) between 1 and 200),
  title text not null check (char_length(title) between 1 and 200),
  url text check (url is null or (char_length(url) <= 1000 and url ~* '^https?://')),
  board text check (board is null or char_length(board) <= 100),
  deadline timestamptz,
  status text not null default 'interested' check (status in ('interested', 'preparing', 'applied', 'result')),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, notice_id)
);
create index if not exists user_opportunities_user_updated_idx on public.user_opportunities (user_id, updated_at desc);
alter table public.user_opportunities enable row level security;
revoke all on public.user_opportunities from public, anon, authenticated;
grant select, insert, update, delete on public.user_opportunities to authenticated;
grant all on public.user_opportunities to service_role;
drop policy if exists "Users can read own opportunities" on public.user_opportunities;
drop policy if exists "Users can insert own opportunities" on public.user_opportunities;
drop policy if exists "Users can update own opportunities" on public.user_opportunities;
drop policy if exists "Users can delete own opportunities" on public.user_opportunities;
create policy "Users can read own opportunities" on public.user_opportunities
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can insert own opportunities" on public.user_opportunities
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own opportunities" on public.user_opportunities
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete own opportunities" on public.user_opportunities
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 사용자당 200행 제한. 같은 사용자의 동시 삽입이 한도를 넘지 않도록 트랜잭션 잠금을 건다.
create or replace function public.user_opportunities_before_insert() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('user_opportunities:' || new.user_id::text, 0));
  -- upsert(ON CONFLICT DO UPDATE)도 이 트리거를 먼저 지나므로, 이미 있는 행의 수정은 한도에 걸리지 않게 한다.
  if exists (select 1 from public.user_opportunities where user_id = new.user_id and notice_id = new.notice_id) then return new; end if;
  if (select count(*) from public.user_opportunities where user_id = new.user_id) >= 200 then
    raise exception 'user_opportunities limit reached' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create or replace function public.user_opportunities_before_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at = now();
  return new;
end $$;
revoke all on function public.user_opportunities_before_insert() from public, anon, authenticated;
revoke all on function public.user_opportunities_before_update() from public, anon, authenticated;
drop trigger if exists user_opportunities_limit on public.user_opportunities;
create trigger user_opportunities_limit before insert on public.user_opportunities
  for each row execute function public.user_opportunities_before_insert();
drop trigger if exists user_opportunities_touch on public.user_opportunities;
create trigger user_opportunities_touch before update on public.user_opportunities
  for each row execute function public.user_opportunities_before_update();
