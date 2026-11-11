-- OpenRouter 지원을 뺀다(사용자 결정 2026-11-12). 무료 자동 선택(openrouter/free)이 요청마다 1~3B급 모델을 무작위로 골라
-- 판정과 이유 문장("-예요", "해당 없음요")이 엉터리로 저장됐다. 업체는 Gemini와 Groq만 남긴다. 멱등이다.

-- 1) 저장된 OpenRouter 키와 그 업체를 고른 설정을 지운다.
delete from public.user_ai_keys where provider = 'openrouter';
update public.user_ai_preferences set manual_provider = null, updated_at = now() where manual_provider = 'openrouter';

-- 2) 업체 허용 목록에서 뺀다.
alter table public.user_ai_keys drop constraint if exists user_ai_keys_provider_check;
alter table public.user_ai_keys add constraint user_ai_keys_provider_check check (provider in ('groq'));
alter table public.user_ai_preferences drop constraint if exists user_ai_preferences_manual_provider_check;
alter table public.user_ai_preferences add constraint user_ai_preferences_manual_provider_check
  check (manual_provider is null or manual_provider in ('gemini', 'groq'));

-- 3) OpenRouter 무료 모델이 만든 판정과 번역은 지운다. 판정 워커가 사용자의 Gemini·Groq 키로 다시 만든다.
delete from public.user_notice_judgments where model like '%:free' or model = 'openrouter/free';
delete from public.user_notice_translations where model like '%:free' or model = 'openrouter/free';
