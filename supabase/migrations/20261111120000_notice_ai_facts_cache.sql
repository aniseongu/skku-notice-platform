-- 공고에서 뽑은 사실(회사 이름, 기간, 업무 분야 등)은 공고 글에만 달려 있고 사용자 프로필과 무관하다.
-- 사용자마다 같은 공고를 Gemini에 다시 묻지 않도록 공고 단위로 한 번만 저장해 모두가 쓴다(무료 키의 하루 호출 한도를 아낀다).
-- 저장하는 것은 Gemini가 낸 사실 JSON뿐이다: 공개 공고 글에서 나온 값이고 개인 정보와 키는 없다. 서비스 역할만 읽고 쓴다.
create table if not exists public.platform_notice_ai_facts (
  notice_id text not null references public.platform_notices(id) on delete cascade,
  text_hash text not null check (text_hash ~ '^[a-f0-9]{32}$'),
  extractor_version text not null check (length(extractor_version) between 1 and 40),
  reply jsonb not null,
  model text not null,
  created_at timestamptz not null default now(),
  primary key (notice_id, text_hash, extractor_version)
);
alter table public.platform_notice_ai_facts enable row level security;
revoke all on public.platform_notice_ai_facts from public, anon, authenticated;
grant all on public.platform_notice_ai_facts to service_role;
