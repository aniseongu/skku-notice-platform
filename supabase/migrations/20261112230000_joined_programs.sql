-- 사용자가 직접 알린 참여 사업·융합연계전공(미래차 부트캠프 등). 참여 학생만 신청하는 공지를 AI가 판정할 때 쓴다.
-- 본인 행만 읽고 쓰는 기존 정책이 그대로 적용된다. 서버 판정 워커는 이 열을 읽으므로 이 파일을 먼저 적용한다(web은 열이 없으면 예전 열로 재시도).
alter table public.user_profiles
  add column if not exists joined_programs text[] not null default '{}';

-- 참여 여부가 바뀌면 그 사용자의 "확인 필요(maybe)" 판정 중 최근 30일 것만 지워 새 정보로 다시 판정하게 한다.
-- 관련 있음·없음 판정과 오래된 글은 건드리지 않는다(무료 키 한도를 아끼려고 범위를 좁게 둔다). 판정은 글에서 다시 만들 수 있는 값이다.
create or replace function public.requeue_maybe_after_joined_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.joined_programs is distinct from old.joined_programs then
    delete from public.user_notice_judgments
    where user_id = new.user_id and verdict = 'maybe' and created_at > now() - interval '30 days';
  end if;
  return new;
end;
$$;

revoke all on function public.requeue_maybe_after_joined_change() from public, anon, authenticated;

drop trigger if exists user_profiles_joined_change on public.user_profiles;
create trigger user_profiles_joined_change
  after update of joined_programs on public.user_profiles
  for each row execute function public.requeue_maybe_after_joined_change();
