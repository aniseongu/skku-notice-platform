import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('push candidates honor subscriptions and start time; keywords and OCR decide silence', async () => {
  const db = new PGlite();
  const user = '00000000-0000-0000-0000-000000000001';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated; insert into auth.users values ('${user}');`);
    for (const name of ['20261107030000_public_notices.sql', '20261107040000_user_subscriptions.sql',
      '20261107060000_user_preferences.sql', '20261107070000_public_ocr_cache.sql',
      '20261107080000_push_subscriptions.sql', '20261107081000_push_claims.sql', '20261107082000_push_candidates.sql', '20261107100000_push_silent_priority.sql']) {
      await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    }
    const hash = 'a'.repeat(64);
    await db.exec(`insert into platform_sources(id,name,url) values ('school','학교','https://www.skku.edu/notice');
      insert into user_source_subscriptions(user_id,source_id,created_at) values ('${user}','school',now()-interval '2 days');
      insert into user_push_subscriptions(user_id,endpoint,p256dh,auth_secret,created_at)
        values ('${user}','https://fcm.googleapis.com/fcm/send/test','${'A'.repeat(87)}','${'A'.repeat(22)}',now()-interval '2 days');
      insert into user_preferences(user_id,keywords) values ('${user}',array['장학']);
      insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,images) values
        ('school/1','school','1','이미지 공지','https://www.skku.edu/notice?articleNo=1',current_date,now()-interval '1 day','["https://www.skku.edu/a.png"]'),
        ('school/2','school','2','이전 장학','https://www.skku.edu/notice?articleNo=2',current_date,now()-interval '3 days','[]');
      insert into platform_ocr_cache(content_sha256,engine_version,extracted_text) values ('${hash}','test','장학 모집');
      insert into platform_notice_images(notice_id,image_url,content_sha256,engine_version,status)
        values ('school/1','https://www.skku.edu/a.png','${hash}','test','ready');
      set role service_role;`);
    let rows = (await db.query('select * from public.list_notice_push_candidates(20)')).rows;
    assert.deepEqual(rows.map((r) => r.notice_id), ['school/1']);
    assert.equal(rows[0].silent, false);
    await db.exec("reset role; insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen) values ('school/3','school','3','관련 없는 공지','https://www.skku.edu/notice?articleNo=3',current_date,now()-interval '12 hours'); set role service_role");
    rows = (await db.query('select * from public.list_notice_push_candidates(20)')).rows;
    assert.deepEqual(rows.map((r) => [r.notice_id, r.silent]), [['school/1', false], ['school/3', true]]);
    await db.exec("reset role; delete from platform_notices where id='school/3'; set role service_role");
    rows = (await db.query('select * from public.list_notice_push_candidates(20)')).rows;
    await db.query(`select public.claim_notice_push('${user}','${rows[0].subscription_id}','school/1')`);
    assert.equal((await db.query('select * from public.list_notice_push_candidates(20)')).rows.length, 0);
    await db.exec("update user_notification_history set status='failed',updated_at=now()-interval '31 minutes'");
    assert.equal((await db.query('select * from public.list_notice_push_candidates(20)')).rows.length, 1);
    await db.exec("reset role; update user_preferences set excluded_keywords=array['장학']; set role service_role");
    const excluded = (await db.query('select * from public.list_notice_push_candidates(20)')).rows;
    assert.deepEqual(excluded.map((r) => [r.notice_id, r.silent]), [['school/1', true]]);
    await db.exec('reset role; set role authenticated');
    await assert.rejects(db.exec('select * from public.list_notice_push_candidates(20)'), /permission denied/);
  } finally { await db.close(); }
});
