-- 저장한 공지를 사용자가 직접 정한 순서. 비어 있으면 저장한 순서를 쓴다.
-- 게시판 순서(board_order)와 같은 방식: 본인 행의 기존 RLS 정책과 열 권한을 그대로 쓰고, 개수와 전체 길이만 제한한다.
-- 공지 id가 사라져도 배열에 남을 수 있으므로 화면이 현재 저장 목록으로 걸러서 쓴다.
alter table public.user_preferences add column if not exists saved_order text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_preferences_saved_order_size' and conrelid = 'public.user_preferences'::regclass) then
    alter table public.user_preferences add constraint user_preferences_saved_order_size check (
      cardinality(saved_order) <= 200 and octet_length(array_to_string(saved_order, ',')) <= 12000
    );
  end if;
end $$;

-- user_preferences는 테이블 단위 권한(authenticated select·insert·update·delete)과 본인 행 정책 네 개로 보호된다. 새 열도 그대로 덮인다.
