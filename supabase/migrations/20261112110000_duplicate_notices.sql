-- 같은 공지가 여러 게시판에 올라올 때(2026-11-12 사용자 지시). 가장 먼저 감지된 글을 대표로 보고, 나머지는 판정·OCR을 건너뛰어
-- 사용자 키 호출과 메모리를 아낀다. 화면도 대표 글만 보여 준다(웹이 같은 dup_key와 3일 이내 게시일로 묶는다).
--  * 학교 게시판 글은 정리한 제목과 본문 앞 400자가 같을 때만 같은 글이다(같은 제목의 다른 학과 안내를 합치지 않는다).
--  * 외부 인턴 공고는 사이트마다 본문이 달라서 정리한 제목(회사·직무 포함)이 같으면 같은 글이다. 학교 글과 외부 글은 합치지 않는다.
-- 글이 고쳐지면(제목이나 기존 본문이 바뀜) 그 글의 사용자별 판정·요약·번역을 지워 다시 만들게 한다.

alter table public.platform_notices add column if not exists dup_key text;
create index if not exists platform_notices_dup_key_idx on public.platform_notices (dup_key) where dup_key is not null;

create or replace function public.set_notice_dup_key() returns trigger
language plpgsql set search_path to '' as $$
declare t text; ext boolean; flat text;
begin
  t := regexp_replace(lower(coalesce(new.title, '')), '[^0-9a-z가-힣]+', '', 'g');
  select coalesce(s.external, false) into ext from public.platform_sources s where s.id = new.source_id;
  flat := regexp_replace(coalesce(new.body, ''), '\s+', '', 'g');
  if length(t) < 8 then new.dup_key := null;
  elsif coalesce(ext, false) then new.dup_key := 'x:' || t;
  elsif length(flat) < 40 then new.dup_key := null;
  else new.dup_key := 's:' || t || ':' || md5(left(flat, 400));
  end if;
  return new;
end $$;
drop trigger if exists platform_notices_dup_key on public.platform_notices;
create trigger platform_notices_dup_key before insert or update of title, body, source_id on public.platform_notices
  for each row execute function public.set_notice_dup_key();
update public.platform_notices set title = title;   -- 기존 글의 dup_key를 채운다

-- p_user가 있으면 그 사용자가 볼 수 있는 글(구독한 게시판, 외부 공고) 중에서만 먼저 본 글을 찾는다.
create or replace function public.dup_loser(p_id text, p_user uuid default null) returns boolean
language sql stable set search_path to '' as $$
  select exists (
    select 1 from public.platform_notices n
    join public.platform_notices o on o.dup_key = n.dup_key and o.id <> n.id
      and abs(o.posted_on - n.posted_on) <= 3 and (o.first_seen, o.id) < (n.first_seen, n.id)
    where n.id = p_id and n.dup_key is not null
      and (p_user is null
        or exists (select 1 from public.platform_sources os where os.id = o.source_id and os.external)
        or exists (select 1 from public.user_source_subscriptions us where us.user_id = p_user and us.source_id = o.source_id)));
$$;
revoke all on function public.dup_loser(text, uuid) from public, anon, authenticated;
grant execute on function public.dup_loser(text, uuid) to service_role;

create or replace function public.invalidate_changed_notice_ai() returns trigger
language plpgsql set search_path to '' as $$
begin
  if (old.body is not null and new.body is distinct from old.body) or new.title is distinct from old.title then
    delete from public.user_notice_judgments where notice_id = new.id;
    delete from public.user_notice_translations where notice_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists platform_notices_invalidate_ai on public.platform_notices;
create trigger platform_notices_invalidate_ai after update of title, body on public.platform_notices
  for each row execute function public.invalidate_changed_notice_ai();

CREATE OR REPLACE FUNCTION public.list_byok_pending(p_user_id uuid, p_limit integer DEFAULT 6)
 RETURNS TABLE(notice_id text, title text, body text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
select n.id, n.title,
         left(concat_ws(E'\n', n.body, (
select string_agg(c.extracted_text, E'\n')
from (select image.content_sha256, image.engine_version from public.platform_notice_images image
where image.notice_id = n.id and image.status = 'ready' order by image.image_url limit 3) ready
join public.platform_ocr_cache c on c.content_sha256 = ready.content_sha256 and c.engine_version = ready.engine_version
         )), 8000)
from public.platform_notices n
join public.platform_sources s on s.id = n.source_id and s.external
where n.fetched_at is not null
and not public.dup_loser(n.id, p_user_id)   -- 같은 글을 먼저 본 다른 글이 있으면 키를 쓰지 않는다
and n.first_seen >= now() - interval '14 days'
and (n.deadline is null or n.deadline >= now())   -- 마감된 공고에는 키를 쓰지 않는다
and not exists (select 1 from public.user_notice_judgments j where j.user_id = p_user_id and j.notice_id = n.id)
and (nullif(btrim(n.body), '') is not null or jsonb_array_length(n.images) = 0
or (select count(*) from public.platform_notice_images i where i.notice_id = n.id and i.status = 'ready')
              >= least(jsonb_array_length(n.images), 3)
or n.fetched_at < now() - interval '24 hours')
order by not (n.deadline is not null and n.deadline < now() + interval '14 days'), case when (n.deadline is not null and n.deadline < now() + interval '14 days') then n.deadline end, n.first_seen desc, n.id
limit least(greatest(coalesce(p_limit, 6), 1), 6);
$function$
;

CREATE OR REPLACE FUNCTION public.list_byok_pending_school(p_user_id uuid, p_limit integer DEFAULT 6)
 RETURNS TABLE(notice_id text, title text, body text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
select n.id, n.title,
           left(concat_ws(E'\n', n.body, (
select string_agg(c.extracted_text, E'\n')
from (select image.content_sha256, image.engine_version from public.platform_notice_images image
where image.notice_id = n.id and image.status = 'ready' order by image.image_url limit 3) ready
join public.platform_ocr_cache c on c.content_sha256 = ready.content_sha256 and c.engine_version = ready.engine_version
                                                                      )), 6000)
from public.user_byok_keys k
join public.platform_notices n on true
join public.platform_sources s on s.id = n.source_id and not s.external
left join public.user_notice_judgments j on j.user_id = k.user_id and j.notice_id = n.id
left join public.user_source_subscriptions us on us.user_id = k.user_id and us.source_id = n.source_id
where k.user_id = p_user_id and k.disabled_at is null
and not public.dup_loser(n.id, p_user_id)   -- 같은 글을 먼저 본 다른 글이 있으면 키를 쓰지 않는다
and (j.notice_id is null or (n.deadline is null and not j.deadline_checked))
and (n.deadline >= now() or (n.deadline is null and n.first_seen >= now() - interval '30 days'))
and (n.fetched_at is not null or n.first_seen < now() - interval '20 minutes')
and (nullif(btrim(n.body), '') is not null or jsonb_array_length(n.images) = 0
or (select count(*) from public.platform_notice_images i where i.notice_id = n.id and i.status = 'ready')
                                                                                                                       >= least(jsonb_array_length(n.images), 3)
or n.first_seen < now() - interval '2 hours')
order by (us.user_id is null), not (n.deadline is not null and n.deadline < now() + interval '14 days'), case when (n.deadline is not null and n.deadline < now() + interval '14 days') then n.deadline end, n.first_seen desc, n.id
limit least(greatest(coalesce(p_limit, 6), 1), 6);
$function$
;
