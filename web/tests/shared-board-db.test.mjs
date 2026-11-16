import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('shared board requests are private and publication subscribes only the requester', async () => {
  const db = new PGlite();
  const a = '00000000-0000-0000-0000-000000000001';
  const b = '00000000-0000-0000-0000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon;
      insert into auth.users values ('${a}'), ('${b}');`);
    for (const name of ['20261107030000_public_notices.sql', '20261107040000_user_subscriptions.sql',
      '20261107111000_source_external_flag.sql', '20261112190000_user_feedback.sql',
      '20261116150000_shared_board_requests.sql']) {
      await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    }
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${a}';
      insert into shared_board_requests(name,url) values ('교환학생', 'https://www.skku.edu/a.do');`);
    const req = (await db.query('select id from shared_board_requests')).rows[0].id;
    await assert.rejects(db.exec(`update shared_board_requests set status='added'`), /permission denied/);
    await assert.rejects(db.query(`select publish_shared_board('${req}', 'https://www.skku.edu/a.do', '[]')`), /permission denied/);
    await db.exec(`set request.jwt.claim.sub = '${b}'`);
    assert.equal((await db.query('select * from shared_board_requests')).rows.length, 0);
    await assert.rejects(db.query(`select submit_shared_board($1, $2, $3)`, [a, '공지', 'https://www.skku.edu/a.do']), /account_changed/);
    await db.exec('reset role; set role service_role');
    const initial = JSON.stringify([{ article_no: '42', title: '공지', category: null,
      url: 'https://www.skku.edu/a.do?mode=view&articleNo=42', posted_on: '2026-11-01', pinned: false }]);
    await db.query('select publish_shared_board($1, $2, $3::jsonb)', [req, 'https://www.skku.edu/a.do', initial]);
    const result = await db.query(`select s.shared_board, r.status, n.first_seen = u.created_at as baseline
      from shared_board_requests r join platform_sources s on s.id=r.source_id
      join user_source_subscriptions u on u.source_id=s.id and u.user_id=r.user_id
      join platform_notices n on n.source_id=s.id where r.id=$1`, [req]);
    assert.deepEqual(result.rows, [{ shared_board: true, status: 'added', baseline: true }]);
    assert.equal((await db.query(`select count(*)::int as n from user_source_subscriptions where user_id=$1`, [b])).rows[0].n, 0);
    await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${b}';
      insert into shared_board_requests(name,url) values ('확인 필요', 'https://www.skku.edu/b.do');`);
    const reviewId = (await db.query('select id from shared_board_requests')).rows[0].id;
    await db.exec('reset role; set role service_role');
    await db.query('select request_shared_board_review($1)', [reviewId]);
    assert.equal((await db.query('select status from shared_board_requests where id=$1', [reviewId])).rows[0].status, 'review');
    assert.equal((await db.query('select count(*)::int as n from user_feedback where user_id=$1', [b])).rows[0].n, 1);
  } finally { await db.close(); }
});
