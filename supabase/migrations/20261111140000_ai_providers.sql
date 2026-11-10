-- Groq·OpenRouter 본인 키와 AI 사용 설정(자동 선택 동의, 무료 우선, 호출 상한). 기존 표는 바꾸지 않는다.
-- Gemini 키는 계속 user_byok_keys에 있고(provider 없는 옛 행 = Gemini), 이 표들은 추가분이다.
-- 키 원문과 암호문은 브라우저가 읽을 수 없다. 서비스 역할(Edge Function, 워커)만 만진다.
create table if not exists public.user_ai_keys (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('groq', 'openrouter')),
  ciphertext text not null check (length(ciphertext) between 40 and 2000),
  key_hint text not null check (key_hint ~ '^[A-Za-z0-9_-]{4}$'),
  model text not null check (model ~ '^[A-Za-z0-9._:/-]{3,100}$'),
  validation_state text not null default 'untested'
    check (validation_state in ('untested', 'valid', 'invalid', 'limited', 'unsupported')),
  validated_at timestamptz,
  disabled_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 200),
  error_at timestamptz,
  used_on date not null default current_date,
  used_today integer not null default 0 check (used_today >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
alter table public.user_ai_keys enable row level security;
revoke all on public.user_ai_keys from public, anon, authenticated;
grant select (user_id, provider, key_hint, model, validation_state, validated_at, disabled_at, last_error, error_at,
              used_on, used_today, created_at, updated_at) on public.user_ai_keys to authenticated;
grant all on public.user_ai_keys to service_role;
drop policy if exists "Users read own AI key status" on public.user_ai_keys;
create policy "Users read own AI key status" on public.user_ai_keys
  for select to authenticated using ((select auth.uid()) = user_id);

-- 설정 행이 없으면 기본값(AI 켬, 직접 선택, 무료 우선)으로 읽는다. 사용자가 자기 행만 쓴다.
create table if not exists public.user_ai_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ai_enabled boolean not null default true,
  routing_mode text not null default 'manual' check (routing_mode in ('manual', 'auto')),
  auto_routing_consent_at timestamptz,
  manual_provider text check (manual_provider is null or manual_provider in ('gemini', 'groq', 'openrouter')),
  free_only boolean not null default true,
  paid_calls_opt_in_at timestamptz,
  daily_request_cap integer check (daily_request_cap is null or daily_request_cap between 1 and 100000),
  updated_at timestamptz not null default now(),
  -- 자동 선택은 동의가 있어야 하고, 유료 호출은 무료 우선을 끄고 동의를 남겨야 한다.
  constraint auto_needs_consent check (routing_mode = 'manual' or auto_routing_consent_at is not null),
  constraint paid_needs_opt_in check (free_only or paid_calls_opt_in_at is not null)
);
alter table public.user_ai_preferences enable row level security;
revoke all on public.user_ai_preferences from public, anon, authenticated;
grant select on public.user_ai_preferences to authenticated;
grant insert (user_id, ai_enabled, routing_mode, auto_routing_consent_at, manual_provider, free_only,
              paid_calls_opt_in_at, daily_request_cap, updated_at) on public.user_ai_preferences to authenticated;
grant update (ai_enabled, routing_mode, auto_routing_consent_at, manual_provider, free_only,
              paid_calls_opt_in_at, daily_request_cap, updated_at) on public.user_ai_preferences to authenticated;
grant all on public.user_ai_preferences to service_role;
drop policy if exists "Users read own AI preferences" on public.user_ai_preferences;
create policy "Users read own AI preferences" on public.user_ai_preferences
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users insert own AI preferences" on public.user_ai_preferences;
create policy "Users insert own AI preferences" on public.user_ai_preferences
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users update own AI preferences" on public.user_ai_preferences;
create policy "Users update own AI preferences" on public.user_ai_preferences
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
