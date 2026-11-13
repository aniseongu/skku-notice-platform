import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// (push-any-ai-key-db 설정 복사) 알림 후보가 Groq·OpenRouter 키(user_ai_keys)만 연결한 사용자도 "키가 있는 사용자"로 본다.
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
const rows = async (db) => { await db.exec('set role service_role'); const r = (await db.query('select notice_id, silent, ai_reason from public.list_notice_push_candidates(20)')).rows; await db.exec('reset role'); return r; };

test('AI users wait for the judgment even when a keyword matches, and the reason rides along whatever the verdict', async () => {
  const { db, user } = await setup();
  try {
    await db.exec(`insert into user_preferences(user_id,keywords) values ('${user}', array['학교'])`);
    assert.equal((await rows(db)).length, 1);   // 키가 없는 사용자는 바로 후보
    await db.exec(`insert into user_ai_keys(user_id,provider,ciphertext,key_hint,model,created_at) values ('${user}','groq','${'x'.repeat(60)}','abcd','llama-3.1-8b-instant',now()-interval '1 day')`);
    assert.deepEqual((await rows(db)).filter((r) => r.notice_id === 'school/1'), []);   // 키워드가 맞아도 판정 전에는 후보가 아니다
    await db.exec(`insert into user_notice_judgments(user_id,notice_id,verdict,reason,model) values ('${user}','school/1','maybe','근무 형태를 확인해 주세요','m')`);
    let [row] = await rows(db);
    assert.equal(row.ai_reason, '근무 형태를 확인해 주세요');   // maybe 이유도 담긴다
    assert.equal(row.silent, false);                          // 키워드가 맞으면 소리로(무음 규칙은 그대로)
    await db.exec(`update user_notice_judgments set verdict='not_relevant', reason='관련 없는 업무예요'`);
    [row] = await rows(db);
    assert.equal(row.ai_reason, '관련 없는 업무예요');
    assert.equal(row.silent, false);                          // 키워드 규칙대로
    await db.exec(`update user_preferences set keywords='{}'`);
    [row] = await rows(db);
    assert.equal(row.silent, true);                           // 키워드가 없고 relevant가 아니면 무음
    await db.exec(`delete from user_notice_judgments; update platform_notices set first_seen = now() - interval '4 hours'`);
    [row] = await rows(db);
    assert.equal(row.ai_reason, null);                        // 3시간이 지나면 판정 없이 보낸다
  } finally { await db.close(); }
});
