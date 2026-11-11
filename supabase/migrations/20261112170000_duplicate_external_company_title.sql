-- 외부 인턴 공고는 제목이 "[회사명] 직무"처럼 회사가 들어 있어 제목만으로도 같은 공고를 알아볼 수 있다(2026-11-12).
-- 사이트마다 본문이 달라서(한 곳은 글, 한 곳은 사진) 본문 비교로는 못 합치던 공고를 제목으로 합친다. 게시일 3일 안.
-- 학교 글과 회사 표기가 없는 외부 제목은 이전 규칙 그대로다(본문이 있으면 본문이 같아야 하고, 사진뿐이면 제목이나 사진 글자). 멱등이다.

create or replace function public.set_notice_dup_key() returns trigger
language plpgsql set search_path to '' as $$
declare t text; ext boolean; pre text; flat text; ocr text; flat_ocr text;
begin
  t := regexp_replace(lower(coalesce(new.title, '')), '[^0-9a-z가-힣]+', '', 'g');
  select coalesce(s.external, false) into ext from public.platform_sources s where s.id = new.source_id;
  ext := coalesce(ext, false);
  pre := case when ext then 'x:' else 's:' end;
  flat := regexp_replace(coalesce(new.body, ''), '\s+', '', 'g');
  new.dup_key := null;
  new.dup_text_key := null;
  if ext and length(t) >= 8 and new.title ~ '^\s*[\[［【(][^\]］】)]{2,}[\]］】)]' then
    new.dup_key := 'x:' || t;   -- 회사명이 든 외부 공고는 본문과 상관없이 제목으로 본다
  end if;
  if length(flat) >= 40 then
    new.dup_text_key := pre || 'b' || md5(left(flat, 400));
  else
    if new.dup_key is null and length(t) >= 8 then new.dup_key := pre || 'img:' || t; end if;
    select string_agg(c.extracted_text, ' ' order by i.image_url) into ocr
      from (select * from public.platform_notice_images where notice_id = new.id and status = 'ready' order by image_url limit 3) i
      join public.platform_ocr_cache c on c.content_sha256 = i.content_sha256 and c.engine_version = i.engine_version;
    flat_ocr := regexp_replace(coalesce(ocr, ''), '\s+', '', 'g');
    if length(flat_ocr) >= 40 then new.dup_text_key := pre || 'o' || md5(left(flat_ocr, 400)); end if;
  end if;
  return new;
end $$;

update public.platform_notices set title = title;

-- 같은 게시판 안의 글끼리는 합치지 않는다. 한 회사의 여러 직무 공고는 회사 소개로 시작하는 본문 앞부분이 같아서 잘못 합쳐졌다(오오비컴퍼니 마케팅과 디자이너).
-- 같은 공지가 두 번 올라오는 일은 서로 다른 게시판 사이에서만 생긴다.
create or replace function public.dup_loser(p_id text, p_user uuid default null) returns boolean
language sql stable set search_path to '' as $$
  select exists (
    select 1 from public.platform_notices n
    join public.platform_notices o on o.id <> n.id and o.source_id <> n.source_id
      and (o.dup_key = n.dup_key or o.dup_text_key = n.dup_text_key)
      and abs(o.posted_on - n.posted_on) <= 3 and (o.first_seen, o.id) < (n.first_seen, n.id)
    where n.id = p_id and (n.dup_key is not null or n.dup_text_key is not null)
      and (p_user is null
        or exists (select 1 from public.platform_sources os where os.id = o.source_id and os.external)
        or exists (select 1 from public.user_source_subscriptions us where us.user_id = p_user and us.source_id = o.source_id)));
$$;
revoke all on function public.dup_loser(text, uuid) from public, anon, authenticated;
grant execute on function public.dup_loser(text, uuid) to service_role;
