-- 본문이 사진뿐인 학교 글도 같은 글이면 합친다(2026-11-12). 본문이 짧으면 정리한 제목과 첫 그림의 내용 해시(OCR이 이미 계산한 값)로 같은 글을 알아본다.
-- 그림이 아직 읽히기 전에는 열쇠가 없어 합치지 않고, 그림 해시가 생기면 열쇠를 다시 만든다. 멱등이다.

create or replace function public.set_notice_dup_key() returns trigger
language plpgsql set search_path to '' as $$
declare t text; ext boolean; flat text; img text;
begin
  t := regexp_replace(lower(coalesce(new.title, '')), '[^0-9a-z가-힣]+', '', 'g');
  select coalesce(s.external, false) into ext from public.platform_sources s where s.id = new.source_id;
  flat := regexp_replace(coalesce(new.body, ''), '\s+', '', 'g');
  if length(t) < 8 then new.dup_key := null;
  elsif coalesce(ext, false) then new.dup_key := 'x:' || t;
  elsif length(flat) >= 40 then new.dup_key := 's:' || t || ':' || md5(left(flat, 400));
  else
    select i.content_sha256 into img from public.platform_notice_images i
      where i.notice_id = new.id and i.status = 'ready' and i.content_sha256 is not null order by i.image_url limit 1;
    new.dup_key := case when img is null then null else 's:' || t || ':i' || left(img, 32) end;
  end if;
  return new;
end $$;

create or replace function public.touch_notice_dup_key() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  update public.platform_notices set title = title where id = new.notice_id;   -- dup_key를 다시 만든다
  return null;
end $$;
revoke all on function public.touch_notice_dup_key() from public, anon, authenticated;
drop trigger if exists platform_notice_images_dup_key on public.platform_notice_images;
create trigger platform_notice_images_dup_key after insert or update of content_sha256, status on public.platform_notice_images
  for each row when (new.status = 'ready' and new.content_sha256 is not null)
  execute function public.touch_notice_dup_key();

update public.platform_notices set title = title;
