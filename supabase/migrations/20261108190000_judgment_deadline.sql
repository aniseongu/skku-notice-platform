-- A deadline (or event time) the user's own Gemini read from the notice body when the title has none, like the original service.
-- It belongs to the user who asked, so it never changes the shared notices table.
alter table public.user_notice_judgments
  add column deadline timestamptz,
  add column deadline_kind text check (deadline_kind is null or deadline_kind in ('마감', '일정'));
alter table public.user_notice_summaries
  add column deadline timestamptz,
  add column deadline_kind text check (deadline_kind is null or deadline_kind in ('마감', '일정'));
