import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// 새로 가입해 밀린 공지가 많은 사람의 키를 어떤 공지에 먼저 쓰는지: 마감된 것은 쓰지 않고, 구독한 게시판 → 마감이 가까운 순 → 최신순.
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
const school = (db, source, no, { deadlineDays = null, seenHours = 1 } = {}) => db.exec(`insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,fetched_at,deadline)
  values ('${source}/${no}','${source}','${no}','공지 ${source} ${no}','https://www.skku.edu/n?articleNo=${no}','2026-11-01', now() - interval '${seenHours} hours', now(),
  ${deadlineDays === null ? 'null' : `now() + interval '${deadlineDays} days'`});`);
const order = async (db, user, fn) => (await db.query(`select notice_id from public.${fn}('${user}', 6)`)).rows.map((r) => r.notice_id);

test('school notices: subscribed boards first, then soonest deadline, then newest; closed ones are never picked', async () => {
  const { db, user } = await setup();
  await db.exec(`insert into platform_sources(id,name,url,external) values ('mine','내 게시판','https://a.skku.edu/n',false), ('other','다른 게시판','https://b.skku.edu/n',false);
    insert into user_byok_keys(user_id, ciphertext, key_hint, model) values ('${user}', '${'x'.repeat(60)}', 'abcd', 'gemini-3.1-flash-lite');
    insert into user_source_subscriptions(user_id, source_id) values ('${user}','mine');`);
  await school(db, 'other', 1, { deadlineDays: 2 });           // 구독 안 한 게시판의 곧 닫히는 공지
  await school(db, 'mine', 2, { seenHours: 1 });                // 구독한 게시판의 새 공지(마감 없음)
  await school(db, 'mine', 3, { deadlineDays: 9 });             // 구독한 게시판, 9일 뒤 마감
  await school(db, 'mine', 4, { deadlineDays: 3 });             // 구독한 게시판, 3일 뒤 마감
  await school(db, 'mine', 5, { deadlineDays: 40, seenHours: 3 });   // 구독한 게시판, 마감이 멀다(2번보다 오래전 수집)
  await school(db, 'mine', 6, { deadlineDays: -1 });            // 이미 마감
  const picked = await order(db, user, 'list_byok_pending_school');
  assert.deepEqual(picked, ['mine/4', 'mine/3', 'mine/2', 'mine/5', 'other/1'].filter((id) => picked.includes(id)));
  assert.ok(!picked.includes('mine/6'), '마감된 공지에는 키를 쓰지 않는다');
  assert.equal(picked[0], 'mine/4');                            // 구독한 게시판에서 가장 먼저 닫히는 공지가 맨 앞
  assert.equal(picked.at(-1), 'other/1');                       // 구독하지 않은 게시판은 가장 뒤
  await db.close();
});

test('external postings: closed ones are skipped, soonest deadline first, then newest', async () => {
  const { db, user } = await setup();
  await db.exec(`insert into platform_sources(id,name,url,external) values ('ext','외부','https://x.test/list',true);`);
  await school(db, 'ext', 1, { seenHours: 5 });
  await school(db, 'ext', 2, { deadlineDays: 20, seenHours: 2 });
  await school(db, 'ext', 3, { deadlineDays: 4, seenHours: 30 });
  await school(db, 'ext', 4, { deadlineDays: -2, seenHours: 3 });   // 마감된 공고
  await db.exec(`update platform_notices set body = '본문' where source_id = 'ext'`);
  const picked = await order(db, user, 'list_byok_pending');
  assert.ok(!picked.includes('ext/4'), '마감된 외부 공고에는 키를 쓰지 않는다');
  // 14일 안에 닫히는 것(ext/3)이 먼저, 나머지는 최신순(2시간 전 ext/2가 5시간 전 ext/1보다 앞).
  assert.deepEqual(picked, ['ext/3', 'ext/2', 'ext/1']);
  await db.close();
});
