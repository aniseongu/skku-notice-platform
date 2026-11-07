-- The personal RSS feed was built and applied, then removed before anyone used it. Remove what it created.
drop function if exists public.list_feed_notices(text, integer);
drop function if exists public.rotate_feed_token();
drop table if exists public.user_feed_tokens;
