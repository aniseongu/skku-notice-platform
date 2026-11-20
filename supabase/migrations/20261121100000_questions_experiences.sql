-- Notice questions and recurring-program experiences. Client access is RPC-only.
begin;

create table if not exists public.qe_series (
  id uuid primary key default gen_random_uuid(),
  organization_key text,
  program_key text,
  check (
    (organization_key is null and program_key is null)
    or (organization_key is not null and program_key is not null
      and organization_key collate "C" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(organization_key) <= 100
      and program_key collate "C" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(program_key) <= 100)
  ),
  unique (organization_key, program_key)
);

create table if not exists public.qe_notice_series (
  notice_id text primary key references public.platform_notices(id) on delete cascade,
  series_id uuid not null references public.qe_series(id)
);
create index if not exists qe_notice_series_series_idx on public.qe_notice_series(series_id);

create table if not exists public.qe_question_aliases (
  notice_id text not null references public.platform_notices(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  anon_no int not null check (anon_no > 0),
  primary key (notice_id, anon_no),
  unique (notice_id, user_id)
);
create index if not exists qe_aliases_user_idx on public.qe_question_aliases(user_id);

create table if not exists public.qe_posts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('question', 'experience')),
  user_id uuid not null references auth.users(id) on delete cascade,
  question_notice_id text references public.platform_notices(id) on delete cascade,
  parent_id uuid,
  series_id uuid references public.qe_series(id),
  notice_id_snapshot text,
  notice_title_snapshot text,
  notice_board_snapshot text,
  body text check (char_length(btrim(body)) between 1 and 500),
  satisfaction int check (satisfaction between 1 and 5),
  learning int check (learning between 1 and 5),
  difficulty int check (difficulty between 1 and 5),
  participated boolean not null default false,
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  deleted_at timestamptz,
  unique (id, question_notice_id),
  foreign key (parent_id, question_notice_id) references public.qe_posts(id, question_notice_id) on delete cascade,
  check (
    (kind = 'question' and question_notice_id is not null and series_id is null
      and notice_id_snapshot is null and notice_title_snapshot is null and notice_board_snapshot is null
      and body is not null and satisfaction is null and learning is null and difficulty is null and not participated)
    or (kind = 'experience' and question_notice_id is null and parent_id is null and series_id is not null
      and notice_id_snapshot is not null and notice_title_snapshot is not null and notice_board_snapshot is not null
      and satisfaction is not null)
  )
);
create index if not exists qe_posts_notice_idx on public.qe_posts(question_notice_id, created_at, id);
create index if not exists qe_posts_parent_idx on public.qe_posts(parent_id);
create index if not exists qe_posts_user_idx on public.qe_posts(user_id);
create index if not exists qe_posts_series_idx on public.qe_posts(series_id, user_id);
create index if not exists qe_posts_deleted_idx on public.qe_posts(deleted_at) where deleted_at is not null;
create unique index if not exists qe_posts_one_experience
  on public.qe_posts(series_id, user_id) where kind = 'experience' and deleted_at is null;

create table if not exists public.qe_reports (
  post_id uuid not null references public.qe_posts(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, reporter_id)
);
create index if not exists qe_reports_reporter_idx on public.qe_reports(reporter_id);

create table if not exists public.qe_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists qe_blocks_blocked_idx on public.qe_blocks(blocked_id);

create table if not exists public.qe_actions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('create', 'edit', 'report', 'block')),
  at timestamptz not null default now()
);
create index if not exists qe_actions_user_idx on public.qe_actions(user_id, at desc);
create index if not exists qe_actions_at_idx on public.qe_actions(at);

alter table public.qe_series enable row level security;
alter table public.qe_notice_series enable row level security;
alter table public.qe_question_aliases enable row level security;
alter table public.qe_posts enable row level security;
alter table public.qe_reports enable row level security;
alter table public.qe_actions enable row level security;
alter table public.qe_blocks enable row level security;
revoke all on public.qe_blocks from public, anon, authenticated, service_role;
revoke all on public.qe_series, public.qe_notice_series, public.qe_question_aliases,
  public.qe_posts, public.qe_reports, public.qe_actions from public, anon, authenticated;
revoke all on sequence public.qe_actions_id_seq from public, anon, authenticated;
grant all on public.qe_series, public.qe_notice_series, public.qe_question_aliases,
  public.qe_posts, public.qe_reports, public.qe_actions to service_role;

create or replace function public.qe_uid() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'qe_unauthenticated' using errcode = '28000'; end if;
  return u;
end $$;

-- The user lock also serializes the account-wide active post cap.
create or replace function public.qe_rate(p_user uuid, p_action text, p_day_limit int) returns void
language plpgsql security definer set search_path = '' as $$
declare action_time timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('qe_user:' || p_user::text, 0));
  action_time := clock_timestamp();
  if (select count(*) from public.qe_actions where user_id = p_user and at > action_time - interval '1 minute') >= 10
    or (select count(*) from public.qe_actions
      where user_id = p_user and action = p_action and at > action_time - interval '1 day') >= p_day_limit then
    raise exception 'qe_rate_limited' using errcode = 'P0001';
  end if;
  if p_action = 'create' and (select count(*) from public.qe_posts where user_id = p_user and deleted_at is null) >= 100 then
    raise exception 'qe_limit_reached' using errcode = 'P0001';
  end if;
  insert into public.qe_actions(user_id, action, at) values (p_user, p_action, action_time);
end $$;

create or replace function public.qe_checked_body(p_body text, p_required boolean) returns text
language plpgsql immutable security definer set search_path = '' as $$
declare
  blanks constant text := U&' \000A\00A0\115F\1160\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\2800\3000\3164\FFA0';
  normalized text := replace(replace(replace(p_body, E'\r\n', E'\n'), E'\r', E'\n'), E'\t', ' ');
  cleaned text := nullif(btrim(normalized, blanks), '');
begin
  if char_length(normalized) > 500 or (p_required and cleaned is null) then
    raise exception 'qe_invalid_input' using errcode = '22023';
  end if;
  -- PostgreSQL text cannot contain U+0000. Newlines survive normalization.
  if normalized collate "C" ~ U&'[\0001-\0009\000B-\001F\007F-\009F\00AD\200B-\200F\202A-\202E\2060\2066-\2069\FEFF]'
    or normalized collate "C" ~* (
      '([<>＜＞]|&(#|lt;|gt;)|(https?|javascript|data|vbscript|file|mailto)[' || blanks || ']*:'
      || '|[a-z][a-z0-9+.-]*://|www[.]|[a-z0-9_.+%-]+@[a-z0-9.-]+'
      || '|01[016789][ .-]?[0-9]{3,4}[ .-]?[0-9]{4}|시발|씨발|병신)'
    ) then
    raise exception 'qe_unsafe_text' using errcode = '22023';
  end if;
  -- Format characters such as variation selectors can accompany visible text,
  -- but cannot make an otherwise blank body count as content.
  if cleaned collate "C" ~ ('^[' || blanks
    || U&'\034F\17B4\17B5\180B-\180F\2061-\2065\206A-\206F\FE00-\FE0F\FFF0-\FFF8\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0000-\+0E0FFF]+$') then
    if p_required then raise exception 'qe_invalid_input' using errcode = '22023'; end if;
    return null;
  end if;
  return cleaned;
end $$;

create or replace function public.qe_check_ratings(p_satisfaction int, p_learning int, p_difficulty int) returns void
language plpgsql immutable security definer set search_path = '' as $$
begin
  if p_satisfaction is null or p_satisfaction not between 1 and 5
    or p_learning not between 1 and 5 or p_difficulty not between 1 and 5 then
    raise exception 'qe_invalid_input' using errcode = '22023';
  end if;
end $$;

create or replace function public.qe_visible(p public.qe_posts, p_viewer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p.deleted_at is null and (p.user_id = p_viewer
    or (p.hidden_at is null and not exists (
      select 1 from public.qe_blocks
      where (blocker_id = p.user_id and blocked_id = p_viewer)
        or (blocker_id = p_viewer and blocked_id = p.user_id))));
$$;

create or replace function public.qe_create_question(p_notice_id text, p_body text, p_parent_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  u uuid := public.qe_uid();
  cleaned text := public.qe_checked_body(p_body, true);
  new_id uuid;
begin
  perform public.qe_rate(u, 'create', 20);
  -- Serializes per-notice counts and alias allocation, and holds off notice deletion.
  perform 1 from public.platform_notices where id = p_notice_id for no key update;
  if not found then raise exception 'qe_notice_not_found' using errcode = 'P0001'; end if;
  if exists (select 1 from public.qe_posts where question_notice_id = p_notice_id and user_id = u
    and hidden_at > now() - interval '30 days') then
    raise exception 'qe_hidden_recently' using errcode = 'P0001';
  end if;
  if p_parent_id is not null then
    perform 1 from public.qe_posts p where p.id = p_parent_id and p.question_notice_id = p_notice_id
      and p.parent_id is null and p.hidden_at is null and public.qe_visible(p, u) for no key update;
    if not found then raise exception 'qe_parent_unavailable' using errcode = 'P0001'; end if;
  end if;
  if (select count(*) from public.qe_posts where question_notice_id = p_notice_id and deleted_at is null) >= 200 then
    raise exception 'qe_limit_reached' using errcode = 'P0001';
  end if;
  insert into public.qe_question_aliases(notice_id, user_id, anon_no)
  select p_notice_id, u, coalesce(max(anon_no), 0) + 1
  from public.qe_question_aliases where notice_id = p_notice_id
  on conflict (notice_id, user_id) do nothing;
  insert into public.qe_posts(kind, user_id, question_notice_id, parent_id, body)
  values ('question', u, p_notice_id, p_parent_id, cleaned) returning id into new_id;
  return new_id;
end $$;

create or replace function public.qe_create_experience(p_notice_id text, p_satisfaction int, p_learning int default null,
  p_difficulty int default null, p_body text default null, p_participated boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  u uuid := public.qe_uid();
  cleaned text := public.qe_checked_body(p_body, false);
  notice record;
  series uuid;
  new_id uuid;
begin
  perform public.qe_check_ratings(p_satisfaction, p_learning, p_difficulty);
  perform public.qe_rate(u, 'create', 20);
  select n.id, n.title, s.name as board into notice
    from public.platform_notices n join public.platform_sources s on s.id = n.source_id
    where n.id = p_notice_id for no key update of n;
  if not found then raise exception 'qe_notice_not_found' using errcode = 'P0001'; end if;
  select series_id into series from public.qe_notice_series where notice_id = p_notice_id;
  if not found then
    insert into public.qe_series default values returning id into series;
    insert into public.qe_notice_series(notice_id, series_id) values (p_notice_id, series);
  end if;
  -- Different notices may point to the same series.
  perform 1 from public.qe_series where id = series for no key update;
  if exists (select 1 from public.qe_posts where series_id = series and user_id = u
    and hidden_at > now() - interval '30 days') then
    raise exception 'qe_hidden_recently' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.qe_posts where series_id = series and user_id = u and deleted_at is null) then
    raise exception 'qe_already_reviewed' using errcode = 'P0001';
  end if;
  if (select count(*) from public.qe_posts where series_id = series and deleted_at is null) >= 500 then
    raise exception 'qe_limit_reached' using errcode = 'P0001';
  end if;
  insert into public.qe_posts(kind, user_id, series_id, notice_id_snapshot, notice_title_snapshot, notice_board_snapshot,
    body, satisfaction, learning, difficulty, participated)
  values ('experience', u, series, notice.id, notice.title, notice.board,
    cleaned, p_satisfaction, p_learning, p_difficulty, coalesce(p_participated, false)) returning id into new_id;
  return new_id;
end $$;

create or replace function public.qe_list_questions(p_notice_id text)
returns table (id uuid, parent_id uuid, body text, anon_no int, created_at timestamptz, mine boolean, hidden boolean, detached boolean)
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := public.qe_uid();
begin
  return query
  with visible as materialized (
    select p.* from public.qe_posts p where p.question_notice_id = p_notice_id and public.qe_visible(p, u)
  )
  select p.id, par.id, p.body, a.anon_no, p.created_at, p.user_id = u, p.hidden_at is not null,
    p.parent_id is not null and par.id is null
  from visible p
  join public.qe_question_aliases a on a.notice_id = p.question_notice_id and a.user_id = p.user_id
  left join visible par on par.id = p.parent_id
  where p.parent_id is null or par.id is not null or p.user_id = u
  order by p.created_at, p.id;
end $$;

create or replace function public.qe_list_experiences(p_notice_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := public.qe_uid(); result jsonb;
begin
  select jsonb_build_object(
    'posts', coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'body', p.body,
      'satisfaction', p.satisfaction, 'learning', p.learning, 'difficulty', p.difficulty,
      'participated', p.participated, 'mine', p.user_id = u, 'hidden', p.hidden_at is not null) order by p.id), '[]'::jsonb),
    'count', count(*) filter (where p.hidden_at is null),
    'satisfaction', jsonb_build_object('average', avg(p.satisfaction) filter (where p.hidden_at is null),
      'count', count(p.satisfaction) filter (where p.hidden_at is null)),
    'learning', jsonb_build_object('average', avg(p.learning) filter (where p.hidden_at is null),
      'count', count(p.learning) filter (where p.hidden_at is null)),
    'difficulty', jsonb_build_object('average', avg(p.difficulty) filter (where p.hidden_at is null),
      'count', count(p.difficulty) filter (where p.hidden_at is null))
  ) into result
  from public.qe_notice_series n join public.qe_posts p on p.series_id = n.series_id
  where n.notice_id = p_notice_id and public.qe_visible(p, u);
  return result;
end $$;

create or replace function public.qe_edit(p_post_id uuid, p_body text, p_satisfaction int default null, p_learning int default null,
  p_difficulty int default null, p_participated boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare u uuid := public.qe_uid(); post_kind text; cleaned text;
begin
  perform public.qe_rate(u, 'edit', 60);
  select kind into post_kind from public.qe_posts
    where id = p_post_id and user_id = u and deleted_at is null and hidden_at is null for no key update;
  if not found then raise exception 'qe_not_found' using errcode = 'P0001'; end if;
  cleaned := public.qe_checked_body(p_body, post_kind = 'question');
  if post_kind = 'experience' then
    perform public.qe_check_ratings(p_satisfaction, p_learning, p_difficulty);
  elsif p_satisfaction is not null or p_learning is not null or p_difficulty is not null or p_participated is true then
    raise exception 'qe_invalid_input' using errcode = '22023';
  end if;
  update public.qe_posts set body = cleaned, satisfaction = p_satisfaction, learning = p_learning,
    difficulty = p_difficulty, participated = coalesce(p_participated, false) where id = p_post_id;
end $$;

create or replace function public.qe_delete(p_post_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.qe_uid();
begin
  perform public.qe_rate(u, 'edit', 60);
  update public.qe_posts set deleted_at = now() where id = p_post_id and user_id = u and deleted_at is null;
  if not found then raise exception 'qe_not_found' using errcode = 'P0001'; end if;
end $$;

create or replace function public.qe_report(p_post_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.qe_uid(); post public.qe_posts;
begin
  -- Serialize duplicates by reporter first, and the threshold by post second.
  perform pg_advisory_xact_lock(hashtextextended('qe_user:' || u::text, 0));
  if exists (select 1 from public.qe_reports where post_id = p_post_id and reporter_id = u) then return; end if;
  perform public.qe_rate(u, 'report', 20);
  select * into post from public.qe_posts where id = p_post_id for no key update;
  if not found or post.user_id = u or not public.qe_visible(post, u)
    or (post.parent_id is not null and not exists (
      select 1 from public.qe_posts p where p.id = post.parent_id and public.qe_visible(p, u))) then
    raise exception 'qe_not_available' using errcode = 'P0001';
  end if;
  insert into public.qe_reports(post_id, reporter_id) values (p_post_id, u);
  if (select count(*) from public.qe_reports where post_id = p_post_id) >= 3 then
    update public.qe_posts set hidden_at = now() where id = p_post_id;
  end if;
end $$;

create or replace function public.qe_block_author(p_post_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.qe_uid(); post public.qe_posts; block_id uuid;
begin
  perform public.qe_rate(u, 'block', 20);
  select * into post from public.qe_posts where id = p_post_id;
  if not found or post.user_id = u or not public.qe_visible(post, u)
    or (post.parent_id is not null and not exists (
      select 1 from public.qe_posts p where p.id = post.parent_id and public.qe_visible(p, u))) then
    raise exception 'qe_not_available' using errcode = 'P0001';
  end if;
  insert into public.qe_blocks(blocker_id, blocked_id) values (u, post.user_id)
  on conflict (blocker_id, blocked_id) do nothing;
  select id into block_id from public.qe_blocks where blocker_id = u and blocked_id = post.user_id;
  return block_id;
end $$;

create or replace function public.qe_list_blocks() returns table (id uuid, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := public.qe_uid();
begin
  return query select b.id, b.created_at from public.qe_blocks b
    where b.blocker_id = u order by b.created_at desc, b.id;
end $$;

create or replace function public.qe_unblock(p_block_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := public.qe_uid();
begin
  delete from public.qe_blocks where id = p_block_id and blocker_id = u;
end $$;

create or replace function public.qe_bind_series(p_notice_id text, p_series_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare old_series uuid;
begin
  -- Keep the same notice-then-series lock order as review creation.
  perform 1 from public.platform_notices where id = p_notice_id for no key update;
  if not found then raise exception 'qe_notice_not_found' using errcode = 'P0001'; end if;
  perform 1 from public.qe_series where id = p_series_id and organization_key is not null for no key update;
  if not found then raise exception 'qe_series_not_found' using errcode = 'P0001'; end if;
  select series_id into old_series from public.qe_notice_series where notice_id = p_notice_id;
  if old_series is null then
    insert into public.qe_notice_series(notice_id, series_id) values (p_notice_id, p_series_id);
    return;
  end if;
  if old_series = p_series_id then return; end if;
  perform 1 from public.qe_series where id = old_series and organization_key is null for no key update;
  if not found or exists (select 1 from public.qe_notice_series where series_id = old_series and notice_id <> p_notice_id) then
    raise exception 'qe_series_conflict' using errcode = 'P0001';
  end if;

  -- Freeze active reviews against concurrent deletes, edits and reports before ranking.
  perform 1 from public.qe_posts where series_id in (old_series, p_series_id) and deleted_at is null
    order by id for no key update;
  with ranked as (
    select id, row_number() over (partition by user_id order by created_at desc, id desc) as position
    from public.qe_posts where series_id in (old_series, p_series_id) and deleted_at is null
  )
  update public.qe_posts p set deleted_at = now()
    from ranked r where p.id = r.id and r.position > 1;

  -- Move soft-deleted history too, so moderation and cooldowns follow the reviews.
  update public.qe_posts set series_id = p_series_id where series_id = old_series;
  update public.qe_notice_series set series_id = p_series_id where notice_id = p_notice_id;
  delete from public.qe_series where id = old_series;
end $$;

create or replace function public.qe_purge() returns int
language plpgsql security definer set search_path = '' as $$
declare deleted_count int;
begin
  delete from public.qe_posts where deleted_at < now() - interval '30 days';
  get diagnostics deleted_count = row_count;
  delete from public.qe_actions where at < now() - interval '2 days';
  return deleted_count;
end $$;

revoke all on function public.qe_uid(), public.qe_rate(uuid, text, int), public.qe_checked_body(text, boolean),
  public.qe_check_ratings(int, int, int), public.qe_visible(public.qe_posts, uuid),
  public.qe_create_question(text, text, uuid), public.qe_create_experience(text, int, int, int, text, boolean),
  public.qe_list_questions(text), public.qe_list_experiences(text), public.qe_edit(uuid, text, int, int, int, boolean),
  public.qe_delete(uuid), public.qe_report(uuid), public.qe_block_author(uuid), public.qe_list_blocks(), public.qe_unblock(uuid),
  public.qe_bind_series(text, uuid), public.qe_purge()
  from public, anon, authenticated, service_role;
grant execute on function public.qe_create_question(text, text, uuid), public.qe_create_experience(text, int, int, int, text, boolean),
  public.qe_list_questions(text), public.qe_list_experiences(text), public.qe_edit(uuid, text, int, int, int, boolean),
  public.qe_delete(uuid), public.qe_report(uuid), public.qe_block_author(uuid), public.qe_list_blocks(), public.qe_unblock(uuid)
  to authenticated;
grant execute on function public.qe_bind_series(text, uuid), public.qe_purge() to service_role;

create or replace function public.purge_expired_data(
  p_closed_days integer default 30, p_stale_days integer default 90, p_limit integer default 500
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  gone text[];
  notices integer := 0;
  coop integer := 0;
  ocr integer := 0;
  alerts integer := 0;
  marks integer := 0;
  team integer := 0;
  qe integer := 0;
begin
  -- expires_at이 지난 공지는 저장한 사용자가 있어도 지운다(딸린 사용자 행은 on delete cascade). 번호는 기록하지 않는다.
  delete from public.platform_notices where id in (
    select n.id from public.platform_notices n
    where n.expires_at is not null and n.expires_at < now()
    order by n.expires_at
    limit greatest(p_limit, 0));
  get diagnostics coop = row_count;

  select coalesce(array_agg(x.id), '{}') into gone from (
    select n.id from public.platform_notices n
    where ((n.deadline is not null and n.deadline < now() - make_interval(days => p_closed_days))
        or (n.deadline is null and n.first_seen < now() - make_interval(days => p_stale_days)))
      and n.expires_at is null
      and not exists (select 1 from public.user_notice_states s where s.notice_id = n.id and s.is_saved)
    order by n.first_seen
    limit greatest(p_limit, 0)
  ) x;
  insert into public.platform_notice_tombstones (id) select unnest(gone) on conflict do nothing;
  delete from public.platform_notices where id = any(gone);
  get diagnostics notices = row_count;

  with orphan as (
    select c.content_sha256, c.engine_version from public.platform_ocr_cache c
    where c.processed_at < now() - interval '7 days'
      and not exists (select 1 from public.platform_notice_images i
                      where i.content_sha256 = c.content_sha256 and i.engine_version = c.engine_version)
    limit greatest(p_limit, 0)
  )
  delete from public.platform_ocr_cache c using orphan o
   where c.content_sha256 = o.content_sha256 and c.engine_version = o.engine_version;
  get diagnostics ocr = row_count;

  delete from public.user_canvas_alerts where status = 'sent' and updated_at < now() - interval '30 days';
  get diagnostics alerts = row_count;

  delete from public.platform_notice_tombstones where deleted_at < now() - interval '400 days';
  get diagnostics marks = row_count;

  -- 팀 모집: 마감 30일·삭제 7일 지난 글과 2일 지난 빈도 기록(team_purge_expired는 security definer, 지운 글 수를 돌려준다).
  team := public.team_purge_expired();
  qe := public.qe_purge();
  return jsonb_build_object('notices', notices, 'expired', coop, 'ocr_cache', ocr, 'canvas_alerts', alerts, 'old_tombstones', marks, 'team', team, 'qe', qe);
end $$;
revoke all on function public.purge_expired_data(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.purge_expired_data(integer, integer, integer) to service_role;

commit;
