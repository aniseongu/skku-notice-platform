-- 출처: https://supabase.com/docs/guides/database/functions
-- 사용자별 행 대신 집계만 공개한다. definer 함수의 검색 경로를 고정한다.
create index if not exists user_notice_states_saved_notice_idx on public.user_notice_states (notice_id) where is_saved;
create or replace function public.notice_save_counts(p_ids text[])
returns table(notice_id text, saves int)
language sql stable security definer set search_path = '' as $$
  select s.notice_id, count(*)::integer
  from public.user_notice_states s
  where s.is_saved and s.notice_id = any (p_ids[1:500])
  group by s.notice_id
  -- 사용자가 적어 1~2명이면 누가 저장했는지 짐작할 수 있다. 3명 이상일 때만 수를 돌려준다.
  having count(*) >= 3;
$$;
revoke all on function public.notice_save_counts(text[]) from public, anon, authenticated;
grant execute on function public.notice_save_counts(text[]) to authenticated;
