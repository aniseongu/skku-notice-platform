-- 첫 설정을 끝낸 계정에 필수 정보가 비어 있으면(업데이트로 새 필수 항목이 생긴 경우 포함) 앱을 열라는 알림을 보낸다(2026-11-16 사용자 지시).
-- 필수 항목의 기준은 web/src/onboarding-flow.ts REQUIRED_ITEMS다. 항목을 더하거나 바꾸면 required_info_missing과
-- web/tests/required-info-reminders-db.test.mjs도 같이 고친다(화면과 서버의 판단이 어긋나지 않게 시험이 비교한다). 멱등이다.

create table if not exists public.user_required_reminders (
  user_id uuid not null references auth.users(id) on delete cascade,
  missing_key text not null check (length(missing_key) between 1 and 200),
  sends integer not null default 0 check (sends >= 0),
  last_sent_at timestamptz,
  primary key (user_id, missing_key)
);
alter table public.user_required_reminders enable row level security;
revoke all on public.user_required_reminders from public, anon, authenticated;
grant all on public.user_required_reminders to service_role;

-- 비어 있는 필수 항목 이름(REQUIRED_ITEMS 순서). 첫 설정을 끝내지 않은 계정은 전체 첫 설정을 거치므로 빈 배열이다.
--  주전공: 전공이 하나도 없음 / 복수전공: 저장된 프로필에서는 전공 수로 답이 정해져 비지 않음(화면과 같다)
--  학교 정보: 졸업이 아닌데 학년 없음. 재학 상태가 비어 있으면 화면(initialDraft)이 '재학'으로 보므로 같게 본다(상태만 비고 학년이 있으면 비지 않은 것)
--  인턴십: 신3품 답이 없음(채움도 아니고 선택 여부도 모름), 또는 소프트웨어학과 원전공인데 입학 연도·솦 인턴십 답이 없음
--  AI 키: 쓸 수 있는 키(Gemini user_byok_keys 또는 Groq user_ai_keys, disabled_at 없음)가 하나도 없음. 화면의 hasUsableAiKey와 같은 기준이다.
create or replace function public.required_info_missing(p_user uuid) returns text[]
language plpgsql stable security definer set search_path to '' as $$
declare
  profile public.user_profiles%rowtype;
  result text[] := '{}';
  software boolean;
begin
  select * into profile from public.user_profiles where user_id = p_user;
  if not found or profile.onboarded_at is null then return '{}'; end if;
  software := profile.programs -> 0 ->> 'college' = '소프트웨어융합대학' and profile.programs -> 0 ->> 'department' = '소프트웨어학과';
  if jsonb_array_length(profile.programs) < 1 then result := array_append(result, '주전공'::text); end if;
  if profile.year is null and coalesce(profile.enrollment_status, '재학') <> '졸업' then result := array_append(result, '학교 정보'::text); end if;
  if (profile.university_3p_internship_done is not true and profile.university_3p_internship_selected is null)
     or (coalesce(software, false) and (profile.admission_year is null or profile.dept_internship_done is null)) then
    result := array_append(result, '인턴십'::text);
  end if;
  if public.active_ai_key_since(p_user) is null then result := array_append(result, 'AI 키'::text); end if;
  return result;
end $$;
revoke all on function public.required_info_missing(uuid) from public, anon, authenticated;
grant execute on function public.required_info_missing(uuid) to service_role;

-- 알릴 차례인 계정. 기기가 있는 계정만, 같은 빈 항목 묶음(missing_key)에 최대 3번: 처음 즉시, 3일 뒤, 다시 7일 뒤.
-- 빈 항목이 달라지면 새 묶음이라 처음부터 다시 센다.
create or replace function public.list_required_info_reminders(p_limit integer default 20)
returns table (user_id uuid, missing text[], missing_key text)
language sql stable security definer set search_path to '' as $$
  select profile.user_id, m.missing, array_to_string(m.missing, ',') as missing_key
  from public.user_profiles profile
  cross join lateral (select public.required_info_missing(profile.user_id) as missing) m
  left join public.user_required_reminders reminder
    on reminder.user_id = profile.user_id and reminder.missing_key = array_to_string(m.missing, ',')
  where profile.onboarded_at is not null
    and cardinality(m.missing) > 0
    and exists (select 1 from public.user_push_subscriptions device where device.user_id = profile.user_id)
    and (
      reminder.user_id is null
      or (reminder.sends = 1 and reminder.last_sent_at <= now() - interval '3 days')
      or (reminder.sends = 2 and reminder.last_sent_at <= now() - interval '7 days')
    )
  order by profile.user_id
  limit greatest(least(coalesce(p_limit, 20), 100), 1);
$$;
revoke all on function public.list_required_info_reminders(integer) from public, anon, authenticated;
grant execute on function public.list_required_info_reminders(integer) to service_role;

create or replace function public.mark_required_reminder(p_user uuid, p_missing_key text) returns void
language sql security definer set search_path to '' as $$
  insert into public.user_required_reminders(user_id, missing_key, sends, last_sent_at)
  values (p_user, p_missing_key, 1, now())
  on conflict (user_id, missing_key) do update set sends = public.user_required_reminders.sends + 1, last_sent_at = now();
$$;
revoke all on function public.mark_required_reminder(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_required_reminder(uuid, text) to service_role;
