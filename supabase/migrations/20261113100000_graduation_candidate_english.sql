-- 영어 제목의 인턴 공고(예: "Global Internship Program 2026")도 졸업요건 판정 대상으로 본다.
-- intern·interns·internship·internships·co-op만 단어 단위로 맞추고 international·internal은 맞추지 않는다(\y = 단어 경계, ~* = 대소문자 무시).
-- 한국어 제외어는 그대로 두고, 같은 뜻의 영어 행정 안내(결과 발표, 설명회, 인증서)만 제외한다.
create or replace function public.is_graduation_candidate_notice(p_title text, p_source_id text, p_external boolean)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select coalesce(p_external, false)
    or (
      (p_source_id = 'skku-career-intern' or p_title ~ '인턴|현장\s*실습' or p_title ~* '\y(?:intern|interns|internship|internships|co-?op)\y')
      and p_title !~ '서류|제출|절차|인증|졸업|수료|설명회|결과|발표|지침|이수|교과목|학점\s*인정'
      and p_title !~* '\y(?:results?|orientation|info(?:rmation)?\s+session|certificates?)\y'
    );
$$;
revoke all on function public.is_graduation_candidate_notice(text, text, boolean) from public, anon, authenticated;
grant execute on function public.is_graduation_candidate_notice(text, text, boolean) to service_role;
