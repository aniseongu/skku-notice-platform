-- 인턴십 졸업요건을 이미 채웠는지. 채웠으면 공지에서 해당 판정을 보여 주지 않는다. 모르면 null(채우지 않은 것으로 본다).
alter table public.user_profiles
  add column if not exists dept_internship_done boolean,
  add column if not exists university_3p_internship_done boolean;
