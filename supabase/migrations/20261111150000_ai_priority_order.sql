-- 키를 어떤 공지에 먼저 쓸지(사용자 키의 하루 한도가 한정돼 있어서 값어치가 큰 것부터 쓴다). 2026-11-11.
--  1) 이미 마감된 공고에는 쓰지 않는다(외부 인턴 공고는 마감 검사가 없었다).
--  2) 사용자가 구독한 게시판을 먼저, 구독하지 않은 게시판은 그 뒤에(학교 공지).
--  3) 마감이 14일 안으로 가까운 것을 먼저, 그 안에서는 마감이 이른 순서(EDF: 가장 먼저 닫히는 것부터).
--  4) 나머지는 최신순.
-- 새로 가입한 사람은 밀린 공지가 많아도 구독한 게시판의 곧 닫히는 공지부터 판정을 받는다. 함수 이름과 인자는 그대로라 워커는 바꾸지 않는다.

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
