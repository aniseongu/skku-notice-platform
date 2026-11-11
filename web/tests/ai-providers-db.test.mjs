import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('AI provider keys are unreadable by browsers and preferences stay per user', async () => {
  const db = new PGlite();
  const a = '00000000-0000-0000-0000-000000000001';
  const b = '00000000-0000-0000-0000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated; insert into auth.users values ('${a}'), ('${b}');`);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261111140000_ai_providers.sql', import.meta.url), 'utf8'));
    const cipher = 'c'.repeat(60);
    await db.exec(`insert into user_ai_keys(user_id,provider,ciphertext,key_hint,model) values
        ('${a}','groq','${cipher}','AbCd','openai/gpt-oss-20b'), ('${a}','openrouter','${cipher}','EfGh','openrouter/free'),
        ('${b}','groq','${cipher}','WxYz','openai/gpt-oss-20b');
      insert into user_ai_preferences(user_id) values ('${b}');
      set role authenticated; set request.jwt.claim.sub = '${a}';`);
    // 본인 키 상태만 보이고 암호문은 읽히지 않는다.
    const own = (await db.query('select provider, key_hint from user_ai_keys order by provider')).rows;
    assert.deepEqual(own.map((r) => r.key_hint), ['AbCd', 'EfGh']);
    await assert.rejects(db.exec('select ciphertext from user_ai_keys'), /permission denied/);
    await assert.rejects(db.exec('select * from user_ai_keys'), /permission denied/);
    await assert.rejects(db.exec(`insert into user_ai_keys(user_id,provider,ciphertext,key_hint,model) values ('${a}','groq','${cipher}','ZZZZ','m')`), /permission denied/);
    await assert.rejects(db.exec(`update user_ai_keys set key_hint='HACK'`), /permission denied/);
    await assert.rejects(db.exec('delete from user_ai_keys'), /permission denied/);
    // 설정: 본인 행만 쓰고 읽는다. 다른 사용자 행은 보이지도 바꿀 수도 없다.
    assert.equal((await db.query('select * from user_ai_preferences')).rows.length, 0);
    await db.exec(`insert into user_ai_preferences(user_id) values ('${a}')`);
    await assert.rejects(db.exec(`insert into user_ai_preferences(user_id) values ('${b}')`), /(permission denied|row-level security|duplicate key)/);
    await db.exec(`update user_ai_preferences set ai_enabled=false`);
    const mine = (await db.query('select user_id, ai_enabled from user_ai_preferences')).rows;
    assert.deepEqual(mine, [{ user_id: a, ai_enabled: false }]);
    const other = await db.query(`select ai_enabled from user_ai_preferences where user_id='${b}'`);
    assert.equal(other.rows.length, 0);
    assert.equal((await db.query('select routing_mode from user_ai_preferences')).rows[0].routing_mode, 'auto');
    await assert.rejects(db.exec(`update user_ai_preferences set manual_provider='bing'`), /check/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.exec('select key_hint from user_ai_keys'), /permission denied/);
    await assert.rejects(db.exec('select * from user_ai_preferences'), /permission denied/);
    await db.exec('reset role; set role service_role');
    assert.equal((await db.query('select ciphertext from user_ai_keys')).rows.length, 3);
  } finally { await db.close(); }
});
