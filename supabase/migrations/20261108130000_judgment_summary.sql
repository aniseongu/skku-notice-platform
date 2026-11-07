-- A short summary of the notice (1-3 sentences) written by the user's own Gemini key in the same call that judges it.
-- Only the owner reads it (the existing "Users read own judgments" policy covers the new column).
alter table public.user_notice_judgments
  add column summary text check (summary is null or char_length(summary) <= 400);
