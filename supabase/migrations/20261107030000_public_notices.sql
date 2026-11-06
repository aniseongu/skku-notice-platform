-- Public school notice data only. User preferences and credentials belong elsewhere.
create table public.platform_sources (
  id text primary key check (id ~ '^[a-z0-9-]+$'),
  name text not null,
  url text not null unique,
  last_success_at timestamptz
);

create table public.platform_notices (
  id text primary key,
  source_id text not null references public.platform_sources(id),
  article_no text not null check (article_no ~ '^[0-9]+$'),
  title text not null,
  category text,
  url text not null,
  posted_on date not null,
  pinned boolean not null default false,
  deadline timestamptz,
  first_seen timestamptz not null,
  fetched_at timestamptz,
  body text,
  body_html text,
  attachments jsonb not null default '[]'::jsonb,
  images jsonb not null default '[]'::jsonb,
  unique (source_id, article_no),
  check (id = source_id || '/' || article_no),
  check (jsonb_typeof(attachments) = 'array'),
  check (jsonb_typeof(images) = 'array')
);

create index platform_notices_source_posted_idx on public.platform_notices (source_id, posted_on desc);
alter table public.platform_sources enable row level security;
alter table public.platform_notices enable row level security;
revoke all on public.platform_sources, public.platform_notices from public, anon, authenticated;
grant select on public.platform_sources, public.platform_notices to anon, authenticated;
grant all on public.platform_sources, public.platform_notices to service_role;
create policy "Public can read school sources" on public.platform_sources for select to anon, authenticated using (true);
create policy "Public can read school notices" on public.platform_notices for select to anon, authenticated using (true);
