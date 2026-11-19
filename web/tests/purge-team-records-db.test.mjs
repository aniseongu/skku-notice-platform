import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// 보관 정리가 팀 모집의 오래된 글(마감 30일·삭제 7일 뒤)과 2일 지난 빈도 기록을 함께 지운다.
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
const post = (n, closesDays, deletedDays) => `insert into team_posts(owner_id,notice_id,notice_title,role,capacity,intro,closes_at,deleted_at)
  values ('00000000-0000-0000-0000-000000000001','n${n}','공고 ${n}','역할',3,'소개',now() + interval '${closesDays} days',
  ${deletedDays === null ? 'null' : `now() - interval '${deletedDays} days'`});`;

test('old team posts and action records are purged, recent ones stay', async () => {
  const { db, user } = await setup();
  try {
    await db.exec([post(1, -40, null), post(2, -10, null), post(3, 5, 10), post(4, 5, 3), post(5, 5, null)].join('\n')
      + `insert into team_actions(user_id,action,at) values ('${user}','post', now() - interval '3 days'), ('${user}','post', now() - interval '1 hour');`);
    const out = (await db.query('select public.purge_expired_data() r')).rows[0].r;
    assert.equal(out.team, 2);
    assert.deepEqual((await db.query('select notice_id from team_posts order by notice_id')).rows.map((r) => r.notice_id), ['n2', 'n4', 'n5']);
    assert.equal((await db.query('select count(*)::int n from team_actions')).rows[0].n, 1);
    // 기존 키는 그대로 있다.
    for (const key of ['notices', 'expired', 'ocr_cache', 'canvas_alerts', 'old_tombstones']) assert.equal(typeof out[key], 'number', key);
  } finally { await db.close(); }
});
