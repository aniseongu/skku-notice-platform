import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-000000000002';
const MIGRATIONS = ['20261107030000_public_notices.sql', '20261107031000_notice_changes.sql', '20261107040000_user_subscriptions.sql',
  '20261107050000_user_notice_states.sql', '20261107060000_user_preferences.sql', '20261107070000_public_ocr_cache.sql',
  '20261107080000_push_subscriptions.sql', '20261107081000_push_claims.sql', '20261107082000_push_candidates.sql',
  '20261107100000_push_silent_priority.sql', '20261107101000_push_original_content.sql', '20261107110000_user_byok.sql',
  '20261107111000_source_external_flag.sql', '20261107112000_byok_judging.sql', '20261107113000_push_ai_candidates.sql',
  '20261108110000_school_judging.sql', '20261108160000_notice_summaries.sql', '20261108180000_school_summary_backfill.sql',
  '20261108190000_judgment_deadline.sql', '20261108200000_automatic_deadlines.sql'];

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated; insert into auth.users values ('${A}'), ('${B}');`);
  for (const name of MIGRATIONS) await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  return db;
}

const seed = (db) => db.exec(`
  insert into platform_sources(id,name,url,external) values ('school','학교','https://www.skku.edu/n',false), ('other','다른 게시판','https://x.skku.edu/n',false);
  insert into user_source_subscriptions(user_id,source_id,created_at) values ('${A}','school',now()-interval '2 days'), ('${B}','school',now()-interval '2 days');
  insert into user_push_subscriptions(user_id,endpoint,p256dh,auth_secret,created_at) values
    ('${A}','https://fcm.googleapis.com/fcm/send/a','${'A'.repeat(87)}','${'A'.repeat(22)}',now()-interval '2 days'),
    ('${B}','https://fcm.googleapis.com/fcm/send/b','${'A'.repeat(87)}','${'A'.repeat(22)}',now()-interval '2 days');
  insert into user_byok_keys(user_id,ciphertext,key_hint,created_at) values ('${A}','${'c'.repeat(60)}','abcd',now()-interval '1 day');
  insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,fetched_at,body,images) values
    ('school/1','school','1','소프트웨어학과 졸업 안내','https://www.skku.edu/1',current_date,now()-interval '5 minutes',now(),'소프트웨어학과 대상','[]'),
    ('school/2','school','2','대학원생 모집','https://www.skku.edu/2',current_date,now()-interval '40 minutes',now(),'대학원생만','[]'),
    ('school/3','school','3','오래된 공지','https://www.skku.edu/3',current_date,now()-interval '4 days',now(),'본문','[]'),
    ('school/4','school','4','키를 넣기 전 공지','https://www.skku.edu/4',current_date,now()-interval '2 days',now(),'본문','[]'),
    ('other/1','other','1','구독하지 않은 게시판','https://x.skku.edu/1',current_date,now()-interval '5 minutes',now(),'본문','[]');`);

test('automatic deadlines cover old and unsubscribed school notices without crossing users or retrying checked results', async () => {
  const db = await database();
  try {
    await seed(db);
    await db.exec('set role service_role');
    const mine = (await db.query(`select notice_id from public.list_byok_pending_school('${A}', 6) order by notice_id`)).rows;
    assert.deepEqual(mine.map((r) => r.notice_id), ['other/1', 'school/1', 'school/2', 'school/3', 'school/4']);
    // 키가 없는 사용자에게는 판정할 것이 없다.
    assert.deepEqual((await db.query(`select * from public.list_byok_pending_school('${B}', 6)`)).rows, []);
    await db.exec(`reset role; insert into user_notice_judgments(user_id,notice_id,verdict,reason,model,deadline_checked) values ('${A}','school/1','relevant','대상이에요','m',true), ('${A}','school/2','maybe','확인','m',false); set role service_role`);
    const pending = (await db.query(`select notice_id from public.list_byok_pending_school('${A}', 6)`)).rows.map((r) => r.notice_id);
    assert.ok(!pending.includes('school/1'));
    assert.ok(pending.includes('school/2'), 'old judgments without deadline extraction are retried');
    await db.exec('reset role; set role authenticated');
    await assert.rejects(db.exec(`select * from public.list_byok_pending_school('${A}', 6)`), /permission denied/);
  } finally { await db.close(); }
});

test('push candidates: a key owner waits for the judgment, relevant is announced normally with the reason, the rest stay silent', async () => {
  const db = await database();
  try {
    await seed(db);
    await db.exec('set role service_role');
    const pick = async () => (await db.query('select user_id, notice_id, silent, ai_reason from public.list_notice_push_candidates(50) order by user_id, notice_id')).rows;
    let rows = await pick();
    const a = rows.filter((r) => r.user_id === A);
    // school/1 is 5분 old and unjudged: held for the key owner. school/2 is older than 30 minutes: goes out silent.
    assert.deepEqual(a.map((r) => [r.notice_id, r.silent]), [['school/2', true]]);
    // 키가 없는 사용자는 기다리지 않는다(기존과 같다).
    assert.deepEqual(rows.filter((r) => r.user_id === B).map((r) => [r.notice_id, r.silent]), [['school/1', true], ['school/2', true]]);
    await db.exec(`reset role; insert into user_notice_judgments(user_id,notice_id,verdict,reason,model) values
      ('${A}','school/1','relevant','소프트웨어학과 재학생이 대상이에요','m'), ('${A}','school/2','not_relevant','대학원생 전용이에요','m'); set role service_role`);
    rows = (await pick()).filter((r) => r.user_id === A);
    assert.deepEqual(rows.map((r) => [r.notice_id, r.silent, r.ai_reason]), [['school/1', false, '소프트웨어학과 재학생이 대상이에요'], ['school/2', true, null]]);
    // 관심 키워드가 맞으면 판정이 not_relevant여도 소리로 알린다(원본 규칙).
    await db.exec(`reset role; insert into user_preferences(user_id,keywords) values ('${A}', array['대학원']); set role service_role`);
    rows = (await pick()).filter((r) => r.user_id === A);
    assert.deepEqual(rows.map((r) => [r.notice_id, r.silent]), [['school/1', false], ['school/2', false]]);
  } finally { await db.close(); }
});
