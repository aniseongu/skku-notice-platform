-- Prioritize image-led notices as the original collector did; retain other images in the queue.
alter table public.platform_notice_images
  add column priority smallint not null default 1 check (priority between 0 and 1),
  add column notice_seen_at timestamptz;
update public.platform_notice_images image
set priority = case when length(btrim(coalesce(notice.body, ''))) < 50 then 0 else 1 end,
    notice_seen_at = notice.first_seen
from public.platform_notices notice
where notice.id = image.notice_id;
create index platform_notice_images_order_idx
  on public.platform_notice_images (priority, last_attempt_at asc nulls first, notice_seen_at desc nulls last);
