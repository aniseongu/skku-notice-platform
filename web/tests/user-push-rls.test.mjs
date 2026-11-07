import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('push capability URLs and notification history are private and owner-bound', async () => {
  const db = new PGlite();
  const a = '00000000-0000-0000-0000-000000000001', b = '00000000-0000-0000-0000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated; insert into auth.users values ('${a}'), ('${b}');`);
    for (const name of ['20261107030000_public_notices.sql', '20261107080000_push_subscriptions.sql', '20261107081000_push_claims.sql']) {
      await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    }
    const publicKey = 'A'.repeat(87), secret = 'A'.repeat(22);
    await db.exec(`insert into user_push_subscriptions(user_id,endpoint,p256dh,auth_secret) values
      ('${b}','https://fcm.googleapis.com/fcm/send/test-b','${publicKey}','${secret}');
      set role authenticated; set request.jwt.claim.sub = '${a}';`);
    assert.equal((await db.query('select * from user_push_subscriptions')).rows.length, 0);
    assert.equal((await db.query(`delete from user_push_subscriptions where user_id='${b}' returning *`)).rows.length, 0);
    await assert.rejects(db.exec(`insert into user_push_subscriptions(user_id,endpoint,p256dh,auth_secret)
      values ('${a}','https://attacker.invalid/path','${publicKey}','${secret}')`), /check constraint/);
    await assert.rejects(db.exec(`insert into user_push_subscriptions(user_id,endpoint,p256dh,auth_secret)
      values ('${b}','https://fcm.googleapis.com/fcm/send/test-c','${publicKey}','${secret}')`), /row-level security/);
    await assert.rejects(db.exec('select * from user_notification_history where true; insert into user_notification_history default values'), /permission denied/);
    await db.exec('reset role');
    await db.exec(`insert into platform_sources(id,name,url) values ('school','학교','https://www.skku.edu/notice');
      insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen)
      values ('school/1','school','1','공지','https://www.skku.edu/notice?articleNo=1','2026-11-01',now());
      set role service_role;`);
    const id = (await db.query(`select id from user_push_subscriptions where user_id='${b}'`)).rows[0].id;
    const claim = `select public.claim_notice_push('${b}','${id}','school/1') as id`;
    assert.ok((await db.query(claim)).rows[0].id);
    assert.equal((await db.query(claim)).rows[0].id, null);
    await db.exec("update user_notification_history set status='failed',updated_at=now()-interval '31 minutes'");
    assert.ok((await db.query(claim)).rows[0].id);
    await db.exec("update user_notification_history set status='sent'");
    assert.equal((await db.query(claim)).rows[0].id, null);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.exec('select * from user_push_subscriptions'), /permission denied/);
    await assert.rejects(db.query(claim), /permission denied/);
  } finally { await db.close(); }
});
