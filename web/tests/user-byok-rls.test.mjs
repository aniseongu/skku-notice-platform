import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('BYOK ciphertext is unreadable by browsers and judgments stay per user', async () => {
  const db = new PGlite();
  const a = '00000000-0000-0000-0000-000000000001';
  const b = '00000000-0000-0000-0000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated; insert into auth.users values ('${a}'), ('${b}');`);
    for (const name of ['20261107030000_public_notices.sql', '20261107110000_user_byok.sql', '20261108220000_user_notice_translations.sql']) {
      await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    }
    const cipher = 'c'.repeat(60);
    await db.exec(`insert into platform_sources(id,name,url) values ('school','학교','https://www.skku.edu/notice');
      insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen)
        values ('school/1','school','1','인턴 모집','https://www.skku.edu/n?1',current_date,now());
      insert into user_byok_keys(user_id,ciphertext,key_hint) values ('${a}','${cipher}','AbCd'), ('${b}','${cipher}','WxYz');
      insert into user_notice_judgments(user_id,notice_id,verdict,reason,model) values ('${a}','school/1','relevant','개발 직무예요','m'), ('${b}','school/1','not_relevant','비개발 직무예요','m');
      insert into user_notice_translations(user_id,notice_id,title,body,model) values
        ('${a}','school/1','내 번역','본문 A','m'), ('${b}','school/1','다른 번역','본문 B','m');
      set role authenticated; set request.jwt.claim.sub = '${a}';`);
    const own = (await db.query('select user_id, key_hint, last_error from user_byok_keys')).rows;
    assert.deepEqual(own.map((r) => r.key_hint), ['AbCd']);
    await assert.rejects(db.exec('select ciphertext from user_byok_keys'), /permission denied/);
    await assert.rejects(db.exec('select * from user_byok_keys'), /permission denied/);
    await assert.rejects(db.exec(`insert into user_byok_keys(user_id,ciphertext,key_hint) values ('${a}','${cipher}','ZZZZ')`), /permission denied/);
    await assert.rejects(db.exec(`update user_byok_keys set key_hint='HACK'`), /permission denied/);
    await assert.rejects(db.exec(`delete from user_byok_keys`), /permission denied/);
    const judged = (await db.query('select user_id, verdict from user_notice_judgments')).rows;
    assert.deepEqual(judged.map((r) => r.verdict), ['relevant']);
    assert.deepEqual((await db.query('select title from user_notice_translations')).rows, [{ title: '내 번역' }]);
    await assert.rejects(db.exec('delete from user_notice_translations'), /permission denied/);
    await assert.rejects(db.exec("update user_notice_translations set title='변조'"), /permission denied/);
    await assert.rejects(db.exec(`insert into user_notice_judgments(user_id,notice_id,verdict,reason,model) values ('${a}','school/1','relevant','x','m')`), /permission denied/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.exec('select key_hint from user_byok_keys'), /permission denied/);
    await assert.rejects(db.exec('select * from user_notice_judgments'), /permission denied/);
    await assert.rejects(db.exec('select * from user_notice_translations'), /permission denied/);
    await db.exec('reset role; set role service_role');
    assert.equal((await db.query('select ciphertext from user_byok_keys')).rows.length, 2);
  } finally { await db.close(); }
});
