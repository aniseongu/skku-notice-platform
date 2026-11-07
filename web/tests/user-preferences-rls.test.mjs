import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('preferences are private, owner-bound and bounded', async () => {
  const db = new PGlite();
  const a = '00000000-0000-0000-0000-000000000001', b = '00000000-0000-0000-0000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated; insert into auth.users values ('${a}'), ('${b}');`);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261107060000_user_preferences.sql', import.meta.url), 'utf8'));
    await db.exec(`insert into user_preferences(user_id,keywords) values ('${b}',array['private']);
      set role authenticated; set request.jwt.claim.sub = '${a}';`);
    assert.equal((await db.query('select * from user_preferences')).rows.length, 0);
    assert.equal((await db.query(`update user_preferences set keywords=array['changed'] where user_id='${b}' returning *`)).rows.length, 0);
    await assert.rejects(db.exec(`insert into user_preferences(user_id,keywords) values ('${b}',array['bad'])`), /row-level security/);
    await assert.rejects(db.exec(`insert into user_preferences(user_id,keywords) values ('${a}',array_fill('word'::text,array[21]))`), /check constraint/);
    await db.exec(`insert into user_preferences(user_id,keywords) values ('${a}',array['장학'])`);
    assert.deepEqual((await db.query('select keywords from user_preferences')).rows[0].keywords, ['장학']);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.exec('select * from user_preferences'), /permission denied/);
  } finally { await db.close(); }
});
