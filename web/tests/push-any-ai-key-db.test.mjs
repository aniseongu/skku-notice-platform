import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// 알림 후보가 Groq·OpenRouter 키(user_ai_keys)만 연결한 사용자도 "키가 있는 사용자"로 본다.
// 키가 있으면 학교 글은 판정을 기다렸다가(이유 줄과 함께) 알리고, 외부 인턴 공고는 관련 있음 판정만 알린다. AI를 꺼 두면 기다리지 않는다.
async function setup() {
  const db = new PGlite();
  const user = '00000000-0000-0000-0000-000000000001';
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated; create schema extensions; insert into auth.users values ('${user}');`);
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
  await db.exec(`insert into platform_sources(id,name,url,external) values ('school','학교','https://www.skku.edu/notice',false), ('ext','외부','https://linkareer.com/list',true);
    insert into user_source_subscriptions(user_id,source_id,created_at) values ('${user}','school',now()-interval '2 days');
    insert into user_push_subscriptions(user_id,endpoint,p256dh,auth_secret,created_at)
      values ('${user}','https://fcm.googleapis.com/fcm/send/test','${'A'.repeat(87)}','${'A'.repeat(22)}',now()-interval '2 days');
    insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,body) values
      ('school/1','school','1','학교 공지','https://www.skku.edu/notice?articleNo=1',current_date,now()-interval '1 hour','본문 글자'),
      ('ext/1','ext','1','백엔드 인턴','https://linkareer.com/activity/1',current_date,now()-interval '1 hour','본문 글자');`);
  return { db, user };
}
const ids = async (db) => { await db.exec('set role service_role'); const rows = (await db.query('select notice_id from public.list_notice_push_candidates(20)')).rows; await db.exec('reset role'); return rows.map((r) => r.notice_id); };

test('a user with only a Groq key waits for the school judgment and gets relevant external postings', async () => {
  const { db, user } = await setup();
  try {
    assert.deepEqual(await ids(db), ['school/1']);   // 키가 없으면 판정을 기다리지 않고, 외부 공고는 보내지 않는다
    await db.exec(`insert into user_ai_keys(user_id,provider,ciphertext,key_hint,model,created_at) values ('${user}','groq','${'x'.repeat(60)}','abcd','llama-3.1-8b-instant',now()-interval '1 day')`);
    assert.deepEqual(await ids(db), []);             // Groq 키만 있어도 판정을 기다린다(예전에는 바로 보내 이유 줄이 없었다)
    await db.exec(`insert into user_notice_judgments(user_id,notice_id,verdict,reason,model) values
      ('${user}','school/1','relevant','지원할 수 있어요','m'), ('${user}','ext/1','relevant','서버 개발 직무예요','m')`);
    assert.deepEqual((await ids(db)).sort(), ['ext/1', 'school/1']);   // 판정이 오면 학교 글과 관련 있는 외부 공고를 보낸다
    await db.exec(`delete from user_notice_judgments; insert into user_ai_preferences(user_id,ai_enabled) values ('${user}',false)`);
    assert.deepEqual(await ids(db), ['school/1']);   // AI를 꺼 두면 판정이 오지 않으니 기다리지 않는다
    await db.exec(`update user_ai_keys set disabled_at = now(); update user_ai_preferences set ai_enabled = true`);
    assert.deepEqual(await ids(db), ['school/1']);   // 꺼진 키는 키가 없는 것과 같다
  } finally { await db.close(); }
});
