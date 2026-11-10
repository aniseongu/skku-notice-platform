-- 키워드가 알림 대상인지 보는 규칙을 목록 화면(웹)의 규칙과 같게 맞춘다.
-- 1) 여러 낱말로 된 키워드("겨울방학 인턴")는 낱말마다 따로 찾고 모두 있어야 맞는다(띄어쓰기는 무시). 전에는 구절 전체가 글자 그대로 있어야 했다.
-- 2) 방학 낱말은 같은 뜻의 말로도 찾는다: 겨울방학=겨울방학·동계·겨울, 여름방학=여름방학·하계·여름.
-- 기간(방학 기간에 맞는 약 2개월짜리인지)은 웹의 목록 표시에서 공고에서 뽑은 기간으로 따로 본다.
create or replace function public.keyword_token_in_text(p_token text, p_haystack text)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select case
    when regexp_replace(lower(p_token), '\s+', '', 'g') in ('겨울방학', '겨울', '동계')
      then p_haystack like '%겨울방학%' or p_haystack like '%동계%' or p_haystack like '%겨울%'
    when regexp_replace(lower(p_token), '\s+', '', 'g') in ('여름방학', '여름', '하계')
      then p_haystack like '%여름방학%' or p_haystack like '%하계%' or p_haystack like '%여름%'
    else strpos(p_haystack, regexp_replace(lower(p_token), '\s+', '', 'g')) > 0
  end;
$$;
revoke all on function public.keyword_token_in_text(text, text) from public, anon, authenticated;
grant execute on function public.keyword_token_in_text(text, text) to service_role;

create or replace function public.keyword_in_text(p_word text, p_text text)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select btrim(coalesce(p_word, '')) <> '' and not exists (
    select 1 from unnest(regexp_split_to_array(btrim(p_word), '\s+')) token
    where not public.keyword_token_in_text(token, regexp_replace(lower(coalesce(p_text, '')), '\s+', '', 'g'))
  );
$$;
revoke all on function public.keyword_in_text(text, text) from public, anon, authenticated;
grant execute on function public.keyword_in_text(text, text) to service_role;

create or replace function public.notice_matched_words(p_notice_id text, p_title text, p_body text, p_words text[])
returns text[] language sql stable security invoker set search_path = '' as $$
  select coalesce(array_agg(distinct btrim(word) order by btrim(word)), '{}'::text[])
  from unnest(coalesce(p_words, '{}'::text[])) word
  where btrim(word) <> '' and (
    public.keyword_in_text(word, p_title || ' ' || coalesce(p_body, ''))
    or exists (select 1 from public.platform_notice_images image
      join public.platform_ocr_cache cache on cache.content_sha256 = image.content_sha256
        and cache.engine_version = image.engine_version
      where image.notice_id = p_notice_id and image.status = 'ready'
        and exists (select 1 from public.platform_notices n where n.id = p_notice_id and n.images ? image.image_url)
        and public.keyword_in_text(word, cache.extracted_text))
  );
$$;
