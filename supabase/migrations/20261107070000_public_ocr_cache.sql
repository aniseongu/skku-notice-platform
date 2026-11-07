-- OCR results are shared public notice data; only the worker may write them.
create table public.platform_ocr_cache (
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  engine_version text not null check (length(engine_version) between 1 and 100),
  extracted_text text not null check (octet_length(extracted_text) <= 1000000),
  processed_at timestamptz not null default now(),
  primary key (content_sha256, engine_version)
);
create table public.platform_notice_images (
  notice_id text not null references public.platform_notices(id) on delete cascade,
  image_url text not null check (length(image_url) between 1 and 2048),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'),
  engine_version text,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  last_attempt_at timestamptz,
  primary key (notice_id, image_url),
  foreign key (content_sha256, engine_version) references public.platform_ocr_cache(content_sha256, engine_version),
  check ((content_sha256 is null) = (engine_version is null)),
  check (status <> 'ready' or content_sha256 is not null)
);
create index platform_notice_images_pending_idx on public.platform_notice_images (last_attempt_at nulls first) where status <> 'ready';
alter table public.platform_ocr_cache enable row level security;
alter table public.platform_notice_images enable row level security;
revoke all on public.platform_ocr_cache, public.platform_notice_images from public, anon, authenticated;
grant select on public.platform_ocr_cache, public.platform_notice_images to anon, authenticated;
grant all on public.platform_ocr_cache, public.platform_notice_images to service_role;
create policy "Public can read OCR cache" on public.platform_ocr_cache for select to anon, authenticated using (true);
create policy "Public can read notice image state" on public.platform_notice_images for select to anon, authenticated using (true);
