-- The list shows "관심 <keyword>" for notices whose title, body or picture text contain one of the user's keywords,
-- like the original service did with a server-made file. Only the caller's own keywords and boards are used.
create function public.my_notice_interests(p_limit integer default 300)
returns table (notice_id text, words text[])
language sql stable security definer set search_path = '' as $$
  select hit.id, hit.words
  from (
    select n.id, n.first_seen, public.notice_matched_words(n.id, n.title, n.body, pref.keywords) as words
    from public.user_preferences pref
    join public.user_source_subscriptions sub on sub.user_id = pref.user_id
    join public.platform_notices n on n.source_id = sub.source_id
    where pref.user_id = (select auth.uid()) and cardinality(pref.keywords) > 0
    order by n.first_seen desc nulls last
    limit least(greatest(coalesce(p_limit, 300), 1), 500)
  ) hit
  where cardinality(hit.words) > 0;
$$;
revoke all on function public.my_notice_interests(integer) from public, anon;
grant execute on function public.my_notice_interests(integer) to authenticated;
