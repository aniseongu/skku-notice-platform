-- 같은 공지 판정을 좁힌다(2026-11-12 사용자 지시): 제목이 같다는 것만으로 합치지 않는다.
--  * 본문이 있는 글(공백을 뺀 40자 이상): 본문 앞 400자가 같아야 같은 글이다(제목이 달라도 본문이 같으면 같은 글). 제목 열쇠는 만들지 않는다.
--  * 본문이 사진뿐인 글(40자 미만): 정리한 제목이 같으면 우선 같은 글로 본다(dup_key). 사진에서 읽은 글자(OCR)가 같으면 제목이 달라도 같은 글이다(dup_text_key).
--  * 본문이 있는 글과 사진뿐인 글은 제목이 같아도 합치지 않는다. 학교 글과 외부 공고도 합치지 않는다. 게시일은 3일 안. 멱등이다.

create or replace function public.set_notice_dup_key() returns trigger
language plpgsql set search_path to '' as $$
declare t text; ext boolean; pre text; flat text; ocr text; flat_ocr text;
begin
  t := regexp_replace(lower(coalesce(new.title, '')), '[^0-9a-z가-힣]+', '', 'g');
  select coalesce(s.external, false) into ext from public.platform_sources s where s.id = new.source_id;
  pre := case when coalesce(ext, false) then 'x:' else 's:' end;
  flat := regexp_replace(coalesce(new.body, ''), '\s+', '', 'g');
  new.dup_key := null;
  new.dup_text_key := null;
  if length(flat) >= 40 then
    new.dup_text_key := pre || 'b' || md5(left(flat, 400));
  else
    if length(t) >= 8 then new.dup_key := pre || 'img:' || t; end if;
    select string_agg(c.extracted_text, ' ' order by i.image_url) into ocr
      from (select * from public.platform_notice_images where notice_id = new.id and status = 'ready' order by image_url limit 3) i
      join public.platform_ocr_cache c on c.content_sha256 = i.content_sha256 and c.engine_version = i.engine_version;
    flat_ocr := regexp_replace(coalesce(ocr, ''), '\s+', '', 'g');
    if length(flat_ocr) >= 40 then new.dup_text_key := pre || 'o' || md5(left(flat_ocr, 400)); end if;
  end if;
  return new;
end $$;

update public.platform_notices set title = title;
