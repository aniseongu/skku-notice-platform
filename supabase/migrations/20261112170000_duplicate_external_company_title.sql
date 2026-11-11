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
