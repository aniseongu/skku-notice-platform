import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('feedback is insert-only, bound to the signed-in account, validated and rate limited', async () => {
  const db = new PGlite();
  const a = '00000000-0000-0000-0000-000000000001', b = '00000000-0000-0000-0000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon; insert into auth.users values ('${a}'), ('${b}');`);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261112190000_user_feedback.sql', import.meta.url), 'utf8'));
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${a}';`);
    await db.exec(`insert into user_feedback(kind, body) values ('question', '로그인이 안 돼요')`);
    await db.exec(`insert into user_feedback(kind, body, reply_email) values ('idea', '다크 모드 좋아요', 'me@example.com')`);
    // 보낸 계정은 서버가 정한다: 다른 계정으로 보낼 수 없고, user_id 열을 직접 쓸 수도 없다.
    await assert.rejects(db.exec(`insert into user_feedback(user_id, kind, body) values ('${b}', 'bug', '남의 이름')`), /permission denied/);
    // 읽을 수 없다(자기가 보낸 글도).
    await assert.rejects(db.query('select * from user_feedback'), /permission denied/);
    await assert.rejects(db.exec(`update user_feedback set body = 'x'`), /permission denied/);
    await assert.rejects(db.exec(`delete from user_feedback`), /permission denied/);
    // 검증: 종류, 길이, 메일 모양.
    await assert.rejects(db.exec(`insert into user_feedback(kind, body) values ('spam', 'x')`), /check constraint/);
    await assert.rejects(db.exec(`insert into user_feedback(kind, body) values ('bug', '   ')`), /check constraint/);
    await assert.rejects(db.exec(`insert into user_feedback(kind, body) values ('bug', '${'가'.repeat(501)}')`), /check constraint/);
    await assert.rejects(db.exec(`insert into user_feedback(kind, body, reply_email) values ('bug', 'x', 'not-an-email')`), /check constraint/);
    // 24시간에 5건까지(이미 2건 보냈다).
    for (let i = 0; i < 3; i++) await db.exec(`insert into user_feedback(kind, body) values ('question', '${i}번째')`);
    await assert.rejects(db.exec(`insert into user_feedback(kind, body) values ('question', '여섯 번째')`), /feedback_limit/);
    // 다른 계정은 따로 센다.
    await db.exec(`set request.jwt.claim.sub = '${b}'`);
    await db.exec(`insert into user_feedback(kind, body) values ('idea', '다른 계정')`);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.exec(`insert into user_feedback(kind, body) values ('bug', 'x')`), /permission denied/);
    // 운영자(서비스 역할)는 읽는다. 계정을 지우면 글도 같이 지워진다.
    await db.exec('reset role; set role service_role');
    assert.equal((await db.query('select count(*)::int as n from user_feedback')).rows[0].n, 6);
    await db.exec(`reset role; delete from auth.users where id = '${a}'`);
    await db.exec('set role service_role');
    assert.equal((await db.query('select count(*)::int as n from user_feedback')).rows[0].n, 1);
  } finally { await db.close(); }
});
