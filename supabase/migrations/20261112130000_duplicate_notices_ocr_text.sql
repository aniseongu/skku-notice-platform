-- 같은 공지 판정 규칙(2026-11-12 사용자 지시). 두 글이 게시일 3일 안이고 다음 중 하나면 같은 공지다. 먼저 감지된 글이 대표다.
--  1) 제목이 같다(dup_key: 부호와 공백을 지운 제목, 8자 이상).
--  2) 제목이 달라도 내용이 같다(dup_text_key): 본문이 있으면 본문 앞 400자, 본문이 사진뿐이면 사진에서 읽은 글자(OCR) 앞 400자의 해시.
-- 학교 글과 외부 인턴 공고는 서로 합치지 않는다(탭이 달라 한쪽만 사라지면 판정이 안 되는 글이 생긴다). 그림이 읽히면 열쇠를 다시 만든다. 멱등이다.

alter table public.platform_notices add column if not exists dup_text_key text;
create index if not exists platform_notices_dup_text_key_idx on public.platform_notices (dup_text_key) where dup_text_key is not null;

create or replace function public.set_notice_dup_key() returns trigger
language plpgsql set search_path to '' as $$
declare t text; ext boolean; pre text; flat text; ocr text; flat_ocr text;
begin
  t := regexp_replace(lower(coalesce(new.title, '')), '[^0-9a-z가-힣]+', '', 'g');
  select coalesce(s.external, false) into ext from public.platform_sources s where s.id = new.source_id;
  pre := case when coalesce(ext, false) then 'x:' else 's:' end;
  flat := regexp_replace(coalesce(new.body, ''), '\s+', '', 'g');
  new.dup_key := case when length(t) >= 8 then pre || t else null end;
  new.dup_text_key := null;
  if length(flat) >= 40 then
    new.dup_text_key := pre || 'b' || md5(left(flat, 400));
  else
    select string_agg(c.extracted_text, ' ' order by i.image_url) into ocr
      from (select * from public.platform_notice_images where notice_id = new.id and status = 'ready' order by image_url limit 3) i
      join public.platform_ocr_cache c on c.content_sha256 = i.content_sha256 and c.engine_version = i.engine_version;
    flat_ocr := regexp_replace(coalesce(ocr, ''), '\s+', '', 'g');
    if length(flat_ocr) >= 40 then new.dup_text_key := pre || 'o' || md5(left(flat_ocr, 400)); end if;
  end if;
  return new;
end $$;

create or replace function public.touch_notice_dup_key() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  update public.platform_notices set title = title where id = new.notice_id;   -- 열쇠를 다시 만든다
  return null;
end $$;
revoke all on function public.touch_notice_dup_key() from public, anon, authenticated;
drop trigger if exists platform_notice_images_dup_key on public.platform_notice_images;
create trigger platform_notice_images_dup_key after insert or update of content_sha256, status on public.platform_notice_images
  for each row when (new.status = 'ready' and new.content_sha256 is not null)
  execute function public.touch_notice_dup_key();

create or replace function public.dup_loser(p_id text, p_user uuid default null) returns boolean
language sql stable set search_path to '' as $$
  select exists (
    select 1 from public.platform_notices n
    join public.platform_notices o on o.id <> n.id
      and (o.dup_key = n.dup_key or o.dup_text_key = n.dup_text_key)
      and abs(o.posted_on - n.posted_on) <= 3 and (o.first_seen, o.id) < (n.first_seen, n.id)
    where n.id = p_id and (n.dup_key is not null or n.dup_text_key is not null)
      and (p_user is null
        or exists (select 1 from public.platform_sources os where os.id = o.source_id and os.external)
        or exists (select 1 from public.user_source_subscriptions us where us.user_id = p_user and us.source_id = o.source_id)));
$$;
revoke all on function public.dup_loser(text, uuid) from public, anon, authenticated;
grant execute on function public.dup_loser(text, uuid) to service_role;

update public.platform_notices set title = title;
