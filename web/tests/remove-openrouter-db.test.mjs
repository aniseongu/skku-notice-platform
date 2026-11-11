import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// OpenRouter 지원을 뺀 migration: 키와 설정, 작은 무료 모델이 만든 판정·번역만 지우고 Gemini·Groq 결과는 남긴다.
test('remove_openrouter migration deletes OpenRouter keys and free-model results only, and is idempotent', async () => {
  const db = new PGlite();
  const a = '00000000-0000-0000-0000-000000000001';
  const b = '00000000-0000-0000-0000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated; insert into auth.users values ('${a}'), ('${b}');
      create table public.user_notice_judgments (user_id uuid, notice_id text, model text);
      create table public.user_notice_translations (user_id uuid, notice_id text, model text);`);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261111140000_ai_providers.sql', import.meta.url), 'utf8'));
    const cipher = 'c'.repeat(60);
    await db.exec(`insert into user_ai_keys(user_id,provider,ciphertext,key_hint,model) values
        ('${a}','groq','${cipher}','AbCd','openai/gpt-oss-20b'), ('${a}','openrouter','${cipher}','EfGh','openrouter/free'),
        ('${b}','openrouter','${cipher}','WxYz','openrouter/free');
      insert into user_ai_preferences(user_id, routing_mode, manual_provider) values ('${a}','manual','openrouter'), ('${b}','manual','groq');
      insert into user_notice_judgments values ('${a}','n/1','gemini-3.1-flash-lite'), ('${a}','n/2','liquid/lfm-3-1.7b:free'),
        ('${a}','n/3','openai/gpt-oss-20b'), ('${b}','n/4','openrouter/free');
      insert into user_notice_translations values ('${a}','n/1','cohere/north-mini-code:free'), ('${a}','n/2','gemini-3.1-flash-lite');`);
    const migration = await readFile(new URL('../../supabase/migrations/20261112100000_remove_openrouter.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration); // 두 번 실행해도 같다
    assert.deepEqual((await db.query('select user_id, provider from user_ai_keys')).rows, [{ user_id: a, provider: 'groq' }]);
    const prefs = (await db.query('select user_id, manual_provider from user_ai_preferences order by user_id')).rows;
    assert.deepEqual(prefs, [{ user_id: a, manual_provider: null }, { user_id: b, manual_provider: 'groq' }]);
    assert.deepEqual((await db.query('select model from user_notice_judgments order by model')).rows.map((r) => r.model), ['gemini-3.1-flash-lite', 'openai/gpt-oss-20b']);
    assert.deepEqual((await db.query('select model from user_notice_translations')).rows.map((r) => r.model), ['gemini-3.1-flash-lite']);
    await assert.rejects(db.exec(`insert into user_ai_keys(user_id,provider,ciphertext,key_hint,model) values ('${b}','openrouter','${cipher}','ZZZZ','m')`), /check/);
    await assert.rejects(db.exec(`update user_ai_preferences set manual_provider='openrouter'`), /check/);
  } finally { await db.close(); }
});
