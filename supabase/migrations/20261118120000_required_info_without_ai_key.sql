-- AI 키를 필수 정보에서 뺀다(2026-11-18 사용자 결정). 키 발급이 가장 힘든 단계라 이탈이 크고, 키 없이도 수집·키워드 푸시·저장·마감은 동작한다.
-- 화면의 기준 web/src/onboarding-flow.ts REQUIRED_ITEMS에서 'ai' 항목을 뺀 것과 같게 required_info_missing에서 'AI 키'를 뺀다.
-- 멱등이다. 운영 반영은 이 migration을 먼저 적용한 뒤 웹을 배포한다(웹이 먼저 나가면 서버가 아직 "AI 키" 알림을 보낼 수 있다).

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
  return result;
end $$;
revoke all on function public.required_info_missing(uuid) from public, anon, authenticated;
grant execute on function public.required_info_missing(uuid) to service_role;

-- 이미 쌓인 알림 이력 정리. missing_key는 빈 항목 이름을 쉼표로 이은 값이라, AI 키가 빠지면 같은 빈 항목 묶음이 새 묶음으로 보여
-- 이미 알린 사람에게 한 번 더 보내게 된다. 그래서 이력의 키에서 'AI 키'만 떼어 보낸 횟수를 이어 간다.
--  1) 'AI 키' 하나뿐인 행: 이제 알릴 항목이 없으므로 삭제한다(대기 중이던 다음 발송도 사라진다).
--  2) '인턴십,AI 키'처럼 섞인 행: 'AI 키'를 뺀 키로 바꾼다. 바꾼 키의 행이 이미 있으면 섞인 행을 그냥 지우지 않고
--     보낸 횟수·시각을 기존 행에 병합(sends·last_sent_at·last_tried_at 중 큰 값)한 뒤 섞인 행을 지운다(지우기만 하면 보낸 횟수가 사라져 재알림이 나갈 수 있다).
-- 주의: 이 migration을 적용한 뒤 아직 옛 푸시 워커가 'AI 키'가 든 키로 행을 새로 만들 수 있다(적용과 워커 교체 사이). 워커를 교체한 직후 이 정리 구간(아래 delete·병합·update)을 한 번 더 돌린다(멱등).
delete from public.user_required_reminders where missing_key = 'AI 키';
update public.user_required_reminders kept
set sends = greatest(kept.sends, old.sends),
    last_sent_at = greatest(kept.last_sent_at, old.last_sent_at),
    last_tried_at = greatest(kept.last_tried_at, old.last_tried_at)
from public.user_required_reminders old
where old.missing_key like '%AI 키%'
  and kept.user_id = old.user_id
  and kept.missing_key = array_to_string(array_remove(string_to_array(old.missing_key, ','), 'AI 키'), ',');
delete from public.user_required_reminders old
where old.missing_key like '%AI 키%'
  and exists (
    select 1 from public.user_required_reminders kept
    where kept.user_id = old.user_id
      and kept.missing_key = array_to_string(array_remove(string_to_array(old.missing_key, ','), 'AI 키'), ',')
  );
update public.user_required_reminders
set missing_key = array_to_string(array_remove(string_to_array(missing_key, ','), 'AI 키'), ',')
where missing_key like '%AI 키%';
