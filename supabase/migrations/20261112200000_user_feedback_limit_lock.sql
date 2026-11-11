-- 문의 한도 보강: (1) 같은 계정의 동시 요청이 한도 확인을 함께 통과하지 못하게 계정별 잠금을 건다. (2) 계정당 총 50건 상한을 둔다.
create or replace function public.user_feedback_limit() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- 같은 계정의 삽입은 순서대로 처리한다(트랜잭션이 끝나면 잠금이 풀린다).
  perform pg_advisory_xact_lock(hashtextextended('user_feedback:' || new.user_id::text, 0));
  if (select count(*) from public.user_feedback where user_id = new.user_id and created_at > now() - interval '1 day') >= 5
     or (select count(*) from public.user_feedback where user_id = new.user_id) >= 50 then
    raise exception 'feedback_limit' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.user_feedback_limit() from public, anon, authenticated;
