import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// 현장실습(coop) 공지와 로그인 전용 읽기: anon은 공지 표 4개를 못 읽고, 정리 함수는 expires_at이 지난 공지만 지우며,
// 현장실습은 새 공지 알림 후보에서 빠진다.
async function setup() {
  const db = new PGlite();
  const user = '00000000-0000-0000-0000-000000000001';
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated; create schema extensions; insert into auth.users values ('${user}');`);
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
  return { db, user };
}
const notice = (id, source, extra = '') => `insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,body,expires_at)
  values ('${id}','${source}','${id.split('/')[1]}','공고 ${id} 제목입니다','https://example.com/${id}',current_date,now()-interval '1 hour','본문 글자'${extra});`;

test('anon cannot read the four notice tables, signed-in users can', async () => {
  const { db } = await setup();
  try {
    await db.exec(`insert into platform_sources(id,name,url,external) values ('school','학교','https://www.skku.edu/notice',false);
      ${notice('school/1', 'school', ',null')}`);
    for (const table of ['platform_sources', 'platform_notices', 'platform_ocr_cache', 'platform_notice_images']) {
      await db.exec('set role anon');
      await assert.rejects(db.query(`select * from ${table}`), /permission denied/, table);
      await db.exec('reset role; set role authenticated');
      const rows = (await db.query(`select count(*)::int n from ${table}`)).rows[0].n;
      assert.ok(rows >= 0, table);
      await db.exec('reset role');
    }
    await db.exec('set role authenticated');
    assert.equal((await db.query(`select count(*)::int n from platform_notices`)).rows[0].n, 1);
    assert.equal((await db.query(`select coop, external from platform_sources where id = 'skku-coop'`)).rows[0].coop, true);
    await db.exec('reset role');
  } finally { await db.close(); }
});

test('expired coop notices are purged (even saved), others are untouched, no tombstone for coop', async () => {
  const { db, user } = await setup();
  try {
    await db.exec(`insert into platform_sources(id,name,url,external) values ('school','학교','https://www.skku.edu/notice',false);
      ${notice('skku-coop/1', 'skku-coop', ", now() - interval '1 minute'")}
      ${notice('skku-coop/2', 'skku-coop', ", now() + interval '5 days'")}
      ${notice('skku-coop/3', 'skku-coop', ',null')}
      ${notice('school/1', 'school', ',null')}
      insert into user_notice_states(user_id,notice_id,is_saved) values ('${user}','skku-coop/1',true);`);
    const out = (await db.query('select public.purge_expired_data() r')).rows[0].r;
    assert.equal(out.expired, 1);
    assert.deepEqual((await db.query('select id from platform_notices order by id')).rows.map((r) => r.id), ['school/1', 'skku-coop/2', 'skku-coop/3']);
    assert.equal((await db.query('select count(*)::int n from user_notice_states')).rows[0].n, 0);
    assert.equal((await db.query(`select count(*)::int n from platform_notice_tombstones`)).rows[0].n, 0);
    // 지운 뒤 같은 번호를 다시 올려도 들어간다.
    await db.exec(notice('skku-coop/1', 'skku-coop', ", now() + interval '3 days'"));
    assert.equal((await db.query(`select count(*)::int n from platform_notices where id = 'skku-coop/1'`)).rows[0].n, 1);
    // 일반 정리(90일)는 expires_at이 있는 현장실습 공지를 건드리지 않는다.
    await db.exec(`update platform_notices set first_seen = now() - interval '200 days' where id in ('skku-coop/2','school/1')`);
    await db.exec('select public.purge_expired_data()');
    assert.deepEqual((await db.query('select id from platform_notices order by id')).rows.map((r) => r.id), ['skku-coop/1', 'skku-coop/2', 'skku-coop/3']);
  } finally { await db.close(); }
});

test('coop notices are never new-notice push candidates, other external postings still are', async () => {
  const { db, user } = await setup();
  try {
    await db.exec(`insert into platform_sources(id,name,url,external) values ('ext','외부','https://linkareer.com/list',true);
      insert into user_push_subscriptions(user_id,endpoint,p256dh,auth_secret,created_at)
        values ('${user}','https://fcm.googleapis.com/fcm/send/test','${'A'.repeat(87)}','${'A'.repeat(22)}',now()-interval '2 days');
      insert into user_ai_keys(user_id,provider,ciphertext,key_hint,model,created_at) values ('${user}','groq','${'x'.repeat(60)}','abcd','llama-3.1-8b-instant',now()-interval '1 day');
      ${notice('ext/1', 'ext', ',null')} ${notice('skku-coop/9', 'skku-coop', ",now() + interval '5 days'")}
      insert into user_notice_judgments(user_id,notice_id,verdict,reason,model) values
        ('${user}','ext/1','relevant','관련 있어요','m'), ('${user}','skku-coop/9','relevant','관련 있어요','m');`);
    await db.exec('set role service_role');
    const ids = (await db.query('select notice_id from public.list_notice_push_candidates(20)')).rows.map((r) => r.notice_id);
    await db.exec('reset role');
    assert.deepEqual(ids, ['ext/1']);
  } finally { await db.close(); }
});

test('coop notices never get duplicate keys, so same-title postings stay separate', async () => {
  const { db } = await setup();
  try {
    await db.exec(`insert into platform_sources(id,name,url,external) values ('ext','외부','https://example.com/ext',true);
      ${notice('skku-coop/1', 'skku-coop', ',null')} ${notice('ext/1', 'ext', ',null')}`);
    const rows = (await db.query(`select id, dup_key from platform_notices order by id`)).rows;
    assert.deepEqual(rows.map((r) => [r.id, r.dup_key === null]), [['ext/1', false], ['skku-coop/1', true]]);
  } finally { await db.close(); }
});
