-- 본문이 사진뿐이라 짧은 학교 글도 같은 공지면 합친다(2026-11-12 사용자 지시). 이런 글은 본문 비교가 안 되므로
-- 정리한 제목이 같고 게시일이 3일 안이면 같은 글로 본다(그림 해시는 쓰지 않는다). 본문이 있는 글은 지금처럼 제목과 본문 앞 400자로 본다.
-- 멱등이다.

create or replace function public.set_notice_dup_key() returns trigger
language plpgsql set search_path to '' as $$
declare t text; ext boolean; flat text;
begin
  t := regexp_replace(lower(coalesce(new.title, '')), '[^0-9a-z가-힣]+', '', 'g');
  select coalesce(s.external, false) into ext from public.platform_sources s where s.id = new.source_id;
  flat := regexp_replace(coalesce(new.body, ''), '\s+', '', 'g');
  if length(t) < 8 then new.dup_key := null;
  elsif coalesce(ext, false) then new.dup_key := 'x:' || t;
  elsif length(flat) >= 40 then new.dup_key := 's:' || t || ':' || md5(left(flat, 400));
  else new.dup_key := 's:' || t || ':t';   -- 본문이 사진뿐인 글은 제목으로만 알아본다
  end if;
  return new;
end $$;

drop trigger if exists platform_notice_images_dup_key on public.platform_notice_images;
drop function if exists public.touch_notice_dup_key();

update public.platform_notices set title = title;
