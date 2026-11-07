-- Free-text profile fields the user writes for Gemini (interests, wanted and unwanted notices). 300 characters each.
-- They are sent to Gemini only inside the judging request for the owner's internship postings.
alter table public.user_profiles
  add column interests text not null default '' check (char_length(interests) <= 300),
  add column wants text not null default '' check (char_length(wants) <= 300),
  add column avoids text not null default '' check (char_length(avoids) <= 300);
