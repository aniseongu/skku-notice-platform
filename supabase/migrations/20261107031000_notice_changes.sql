-- Public source changes, never per-user judgments.
alter table public.platform_notices
  add column changed_at timestamptz,
  add column change_kind text check (change_kind in ('제목', '본문')),
  add column previous_title text;
