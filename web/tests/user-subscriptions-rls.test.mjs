import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('subscriptions are isolated between users and unavailable anonymously', async () => {
  const db = new PGlite();
  const a = '00000000-0000-0000-0000-000000000001';
  const b = '00000000-0000-0000-0000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;
      insert into auth.users values ('${a}'), ('${b}');`);
    for (const name of ['20261107030000_public_notices.sql', '20261107040000_user_subscriptions.sql']) {
      await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    }
    await db.exec("insert into platform_sources(id,name,url) values ('school','학교','https://www.skku.edu/notice')");
    await db.exec(`insert into user_source_subscriptions(user_id,source_id) values ('${b}','school')`);
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${a}'`);
    assert.equal((await db.query('select * from user_source_subscriptions')).rows.length, 0);
    assert.equal((await db.query(`update user_source_subscriptions set notifications_enabled=false where user_id='${b}' returning *`)).rows.length, 0);
    assert.equal((await db.query(`delete from user_source_subscriptions where user_id='${b}' returning *`)).rows.length, 0);
    await assert.rejects(db.exec(`insert into user_source_subscriptions(user_id,source_id) values ('${b}','school')`), /row-level security/);
    await db.exec(`insert into user_source_subscriptions(user_id,source_id) values ('${a}','school')`);
    assert.equal((await db.query('select * from user_source_subscriptions')).rows.length, 1);
    await assert.rejects(db.exec(`update user_source_subscriptions set user_id='${b}' where user_id='${a}'`), /row-level security/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.exec('select * from user_source_subscriptions'), /permission denied/);
  } finally { await db.close(); }
});
