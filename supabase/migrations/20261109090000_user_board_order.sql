-- 왼쪽 목록에서 게시판을 보여 줄 순서. 비어 있으면 기본 순서를 쓴다.
alter table public.user_preferences
  add column board_order text[] not null default '{}',
  add constraint user_preferences_board_order_size check (cardinality(board_order) <= 200);
