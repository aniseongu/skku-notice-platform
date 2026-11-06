import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('saved and read state cannot be accessed or changed across users', async () => {
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
    for (const name of ['20261107030000_public_notices.sql', '20261107050000_user_notice_states.sql']) {
      await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    }
    await db.exec(`insert into platform_sources(id,name,url) values ('school','학교','https://www.skku.edu/notice');
      insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen)
      values ('school/1','school','1','공지','https://www.skku.edu/notice?articleNo=1','2026-11-01',now());
      insert into user_notice_states(user_id,notice_id,is_saved) values ('${b}','school/1',true);
      set role authenticated; set request.jwt.claim.sub = '${a}';`);
    assert.equal((await db.query('select * from user_notice_states')).rows.length, 0);
    assert.equal((await db.query(`update user_notice_states set is_saved=false where user_id='${b}' returning *`)).rows.length, 0);
    assert.equal((await db.query(`delete from user_notice_states where user_id='${b}' returning *`)).rows.length, 0);
    await assert.rejects(db.exec(`insert into user_notice_states(user_id,notice_id) values ('${b}','school/1')`), /row-level security/);
    await db.exec(`insert into user_notice_states(user_id,notice_id,read_at) values ('${a}','school/1',now())`);
    assert.equal((await db.query('select * from user_notice_states')).rows.length, 1);
    await assert.rejects(db.exec(`update user_notice_states set user_id='${b}' where user_id='${a}'`), /row-level security/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.exec('select * from user_notice_states'), /permission denied/);
  } finally { await db.close(); }
});
