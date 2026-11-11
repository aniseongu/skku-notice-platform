import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// 보관 기준: 마감 30일 뒤, 마감 없으면 90일 뒤. 저장한 공지는 제외. 지운 번호는 기록해 다시 들어오지 않는다.
async function setup() {
  const db = new PGlite();
  const a = '00000000-0000-0000-0000-000000000001';
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated; insert into auth.users values ('${a}');`);
  for (const name of ['20261107030000_public_notices.sql', '20261107050000_user_notice_states.sql', '20261107070000_public_ocr_cache.sql',
    '20261108100000_user_canvas_tokens.sql', '20261108120000_canvas_worker.sql', '20261111140000_retention_purge.sql']) {
    try { await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8')); }
    catch (error) { throw new Error(`${name}: ${error.message}`); }
  }
  await db.exec(`insert into platform_sources(id,name,url) values ('school','학교','https://www.skku.edu/notice');`);
  return { db, a };
}
// id는 "게시판/번호" 형식이어야 한다. 시험에서는 번호만 써서 school/<번호>로 만든다.
const notice = (no, deadlineDays, seenDays) => `insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,deadline)
  values ('school/${no}','school','${no}','공지 ${no}','https://www.skku.edu/notice?articleNo=${no}','2026-01-01', now() - interval '${seenDays} days',
  ${deadlineDays === null ? 'null' : `now() + interval '${deadlineDays} days'`});`;
const ids = async (db) => (await db.query('select id from platform_notices order by id')).rows.map((row) => row.id);

test('closed notices are removed after 30 days, open ones and recent ones stay', async () => {
  const { db } = await setup();
  await db.exec([notice(1, -40, 60), notice(2, -10, 20), notice(3, 5, 5), notice(4, null, 100), notice(5, null, 30)].join('\n'));
  const out = (await db.query('select public.purge_expired_data() as r')).rows[0].r;
  assert.equal(out.notices, 2);
  assert.deepEqual(await ids(db), ['school/2', 'school/3', 'school/5']);
  assert.equal((await db.query('select count(*)::int as n from platform_notice_tombstones')).rows[0].n, 2);
  await db.close();
});

test('a notice somebody saved is never removed, even long after the deadline', async () => {
  const { db, a } = await setup();
  await db.exec(notice(10, -200, 300) + notice(11, -200, 300) + `insert into user_notice_states(user_id,notice_id,is_saved) values ('${a}','school/10',true);`);
  await db.exec('select public.purge_expired_data()');
  assert.deepEqual(await ids(db), ['school/10']);
  await db.close();
});

test('a removed notice that the crawler sees again is not inserted as a new notice (no stale push)', async () => {
  const { db } = await setup();
  await db.exec(notice(7001, -60, 90));
  await db.exec('select public.purge_expired_data()');
  assert.equal((await db.query('select count(*)::int as n from platform_notices')).rows[0].n, 0);
  // 수집기는 on_conflict upsert로 넣는다: 지운 번호는 조용히 건너뛰고, 새 번호는 그대로 들어간다.
  await db.exec(`insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen) values
    ('school/7001','school','7001','다시 수집','https://www.skku.edu/notice?articleNo=7001','2026-01-01',now()),
    ('school/7002','school','7002','새 글','https://www.skku.edu/notice?articleNo=7002','2026-11-11',now())
    on conflict (id) do update set title = excluded.title`);
  assert.deepEqual(await ids(db), ['school/7002']);
  await db.close();
});

test('derived rows go with the notice, and unreferenced OCR cache and sent alerts are cleaned in batches', async () => {
  const { db, a } = await setup();
  await db.exec(notice(20, -60, 90) + notice(21, 5, 1) + `
    insert into user_notice_states(user_id,notice_id,read_at) values ('${a}','school/20',now());
    insert into platform_ocr_cache(content_sha256,engine_version,extracted_text,processed_at) values
      ('${'a'.repeat(64)}','e1','쓰는 중', now() - interval '30 days'),
      ('${'b'.repeat(64)}','e1','아무도 안 가리킴', now() - interval '30 days'),
      ('${'c'.repeat(64)}','e1','방금 만듦', now());
    insert into platform_notice_images(notice_id,image_url,content_sha256,engine_version,status)
      values ('school/21','https://x/img.png','${'a'.repeat(64)}','e1','ready');`);
  const out = (await db.query('select public.purge_expired_data() as r')).rows[0].r;
  assert.equal((await db.query('select count(*)::int as n from user_notice_states')).rows[0].n, 0);   // 공지와 함께
  assert.deepEqual((await db.query('select content_sha256 from platform_ocr_cache order by 1')).rows.map((r) => r.content_sha256[0]), ['a', 'c']);
  assert.equal(out.ocr_cache, 1);
  // 한 번에 지우는 수를 제한한다.
  await db.exec([...Array(5).keys()].map((i) => notice(100 + i, -100, 120)).join('\n'));
  assert.equal((await db.query('select public.purge_expired_data(30, 90, 2) as r')).rows[0].r.notices, 2);
  await db.close();
});

test('only the service role can run the purge', async () => {
  const { db } = await setup();
  await db.exec('set role authenticated');
  await assert.rejects(db.exec('select public.purge_expired_data()'), /permission denied/);
  await db.exec('reset role; set role anon');
  await assert.rejects(db.exec('select * from platform_notice_tombstones'), /permission denied/);
  await db.close();
});
