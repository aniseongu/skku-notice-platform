-- External internship sources are shown in their own tab and are not school boards a user can subscribe to.
alter table public.platform_sources add column external boolean not null default false;
