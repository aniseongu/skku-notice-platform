import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('public notice data is readable, but only the worker can write it', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls');
    await db.exec(await readFile(new URL('../../supabase/migrations/20261107030000_public_notices.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../../supabase/migrations/20261107031000_notice_changes.sql', import.meta.url), 'utf8'));
    await db.exec("insert into platform_sources (id,name,url) values ('school','학교','https://www.skku.edu/notice')");
    await db.exec("insert into platform_notices (id,source_id,article_no,title,url,posted_on,first_seen) values ('school/1','school','1','공지','https://www.skku.edu/notice?articleNo=1','2026-11-01',now())");
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      assert.equal((await db.query('select id from platform_notices')).rows.length, 1);
      await assert.rejects(db.exec("delete from platform_notices where id = 'school/1'"), /permission denied/);
      await assert.rejects(db.exec("update platform_sources set name = 'changed'"), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    await db.exec("update platform_sources set name = '변경' where id = 'school'");
    assert.equal((await db.query('select name from platform_sources')).rows[0].name, '변경');
  } finally { await db.close(); }
});
