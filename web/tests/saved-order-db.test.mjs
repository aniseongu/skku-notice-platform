import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('saved_order is owner-only, bounded and the migration is idempotent', async () => {
  const db = new PGlite();
  const a = '00000000-0000-0000-0000-000000000001', b = '00000000-0000-0000-0000-000000000002';
  const run = async (name) => db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated; insert into auth.users values ('${a}'), ('${b}');`);
    await run('20261107060000_user_preferences.sql');
    await run('20261109090000_user_board_order.sql');
    await run('20261120100000_saved_order.sql');
    await run('20261120100000_saved_order.sql');   // 두 번 적용해도 오류가 없다
    await db.exec(`insert into user_preferences(user_id,saved_order) values ('${b}',array['secret']);
      set role authenticated; set request.jwt.claim.sub = '${a}';`);
    assert.equal((await db.query('select saved_order from user_preferences')).rows.length, 0);   // 남의 순서는 읽지 못한다
    assert.equal((await db.query(`update user_preferences set saved_order=array['x'] where user_id='${b}' returning *`)).rows.length, 0);
    await assert.rejects(db.exec(`insert into user_preferences(user_id,saved_order) values ('${b}',array['x'])`), /row-level security/);
    await db.exec(`insert into user_preferences(user_id,saved_order) values ('${a}',array['n1','n2'])`);
    assert.deepEqual((await db.query('select saved_order from user_preferences')).rows[0].saved_order, ['n1', 'n2']);
    await db.exec(`update user_preferences set saved_order=array['n2','n1'] where user_id='${a}'`);
    await assert.rejects(db.exec(`update user_preferences set saved_order=array_fill('x'::text,array[201]) where user_id='${a}'`), /check constraint/);
    await assert.rejects(db.exec(`update user_preferences set saved_order=array_fill(repeat('x',100),array[150]) where user_id='${a}'`), /check constraint/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.exec('select saved_order from user_preferences'), /permission denied/);
  } finally { await db.close(); }
});
