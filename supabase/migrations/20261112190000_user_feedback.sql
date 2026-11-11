-- 앱 안 문의: 로그인한 사용자가 짧은 글을 보내면 운영자(서비스 역할)만 읽는다. 사용자는 자기가 보낸 글도 읽지 못한다(삽입 전용).
create table public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('question', 'bug', 'idea')),
  body text not null check (char_length(btrim(body)) between 1 and 500),
  reply_email text check (reply_email is null or (char_length(reply_email) <= 254 and reply_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  created_at timestamptz not null default now()
);
alter table public.user_feedback enable row level security;
revoke all on public.user_feedback from public, anon, authenticated;
-- user_id는 서버 기본값(로그인한 계정)으로만 채워지게 열 단위로 권한을 준다.
grant insert (kind, body, reply_email) on public.user_feedback to authenticated;
grant all on public.user_feedback to service_role;
create policy "Users send own feedback" on public.user_feedback for insert to authenticated with check ((select auth.uid()) = user_id);

-- 도배 방지: 계정마다 24시간에 5건까지.
create function public.user_feedback_limit() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.user_feedback where user_id = new.user_id and created_at > now() - interval '1 day') >= 5 then
    raise exception 'feedback_limit' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.user_feedback_limit() from public, anon, authenticated;
create trigger user_feedback_limit before insert on public.user_feedback for each row execute function public.user_feedback_limit();
