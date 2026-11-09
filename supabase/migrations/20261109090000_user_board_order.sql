-- 왼쪽 목록에서 게시판을 보여 줄 순서. 비어 있으면 기본 순서를 쓴다.
-- 키워드 칸처럼 개수와 전체 길이를 제한한다(게시판 id는 짧은 영문이라 넉넉하다).
alter table public.user_preferences
  add column board_order text[] not null default '{}',
  add constraint user_preferences_board_order_size check (
    cardinality(board_order) <= 200 and octet_length(array_to_string(board_order, ',')) <= 8000
  );
