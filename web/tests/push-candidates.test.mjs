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
    for (const name of ['20261107030000_public_notices.sql', '20261107031000_notice_changes.sql', '20261107040000_user_subscriptions.sql',
      '20261107060000_user_preferences.sql', '20261107070000_public_ocr_cache.sql',
      '20261107080000_push_subscriptions.sql', '20261107081000_push_claims.sql', '20261107082000_push_candidates.sql', '20261107100000_push_silent_priority.sql', '20261107050000_user_notice_states.sql', '20261107101000_push_original_content.sql']) {
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

test('change alerts go once per change, only for keyword matches or saved notices, with original content fields', async () => {
  const db = new PGlite();
  const user = '00000000-0000-0000-0000-000000000001';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated; insert into auth.users values ('${user}');`);
    for (const name of ['20261107030000_public_notices.sql', '20261107031000_notice_changes.sql', '20261107040000_user_subscriptions.sql',
      '20261107060000_user_preferences.sql', '20261107070000_public_ocr_cache.sql', '20261107080000_push_subscriptions.sql',
      '20261107081000_push_claims.sql', '20261107082000_push_candidates.sql', '20261107100000_push_silent_priority.sql',
      '20261107050000_user_notice_states.sql', '20261107101000_push_original_content.sql']) {
      await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    }
    await db.exec(`insert into platform_sources(id,name,url) values ('school','소프트웨어학과','https://www.skku.edu/notice');
      insert into user_source_subscriptions(user_id,source_id,created_at) values ('${user}','school',now()-interval '2 days');
      insert into user_push_subscriptions(user_id,endpoint,p256dh,auth_secret,created_at)
        values ('${user}','https://fcm.googleapis.com/fcm/send/test','${'A'.repeat(87)}','${'A'.repeat(22)}',now()-interval '2 days');
      insert into user_preferences(user_id,keywords) values ('${user}',array['장학']);
      insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,changed_at,change_kind,deadline) values
        ('school/1','school','1','장학 안내','https://www.skku.edu/n?1',current_date,now()-interval '3 days',now()-interval '1 hour','제목',now()+interval '3 days'),
        ('school/2','school','2','일반 공지','https://www.skku.edu/n?2',current_date,now()-interval '3 days',now()-interval '1 hour','본문',null),
        ('school/3','school','3','저장한 공지','https://www.skku.edu/n?3',current_date,now()-interval '3 days',now()-interval '1 hour','본문',null);
      insert into user_notice_states(user_id,notice_id,is_saved) values ('${user}','school/3',true);
      set role service_role;`);
    let rows = (await db.query('select * from public.list_notice_push_candidates(20)')).rows;
    assert.deepEqual(rows.map((r) => [r.notice_id, r.kind]).sort(), [['school/1', 'changed'], ['school/3', 'changed']]);
    const first = rows.find((r) => r.notice_id === 'school/1');
    assert.equal(first.silent, false);
    assert.equal(first.change_kind, '제목');
    assert.equal(first.source_name, '소프트웨어학과');
    assert.deepEqual(first.matched_words, ['장학']);
    assert.ok(first.deadline);
    await db.query(`select public.claim_notice_push('${user}','${first.subscription_id}','school/1','changed','${new Date(first.change_marker).toISOString()}')`);
    rows = (await db.query('select * from public.list_notice_push_candidates(20)')).rows;
    assert.deepEqual(rows.map((r) => r.notice_id), ['school/3']);
    await db.exec("reset role; update platform_notices set changed_at = now(), change_kind = '본문' where id = 'school/1'; set role service_role");
    rows = (await db.query('select * from public.list_notice_push_candidates(20)')).rows;
    assert.deepEqual(rows.map((r) => r.notice_id).sort(), ['school/1', 'school/3']);
  } finally { await db.close(); }
});

test('external postings notify only for relevant judgments made with the user key, after the key was registered', async () => {
  const db = new PGlite();
  const user = '00000000-0000-0000-0000-000000000001';
  const other = '00000000-0000-0000-0000-000000000002';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated; insert into auth.users values ('${user}'), ('${other}');`);
    for (const name of ['20261107030000_public_notices.sql', '20261107031000_notice_changes.sql', '20261107040000_user_subscriptions.sql',
      '20261107060000_user_preferences.sql', '20261107070000_public_ocr_cache.sql', '20261107080000_push_subscriptions.sql',
      '20261107081000_push_claims.sql', '20261107082000_push_candidates.sql', '20261107100000_push_silent_priority.sql',
      '20261107050000_user_notice_states.sql', '20261107101000_push_original_content.sql', '20261107110000_user_byok.sql',
      '20261107111000_source_external_flag.sql', '20261107113000_push_ai_candidates.sql']) {
      await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    }
    const cipher = 'c'.repeat(60);
    await db.exec(`insert into platform_sources(id,name,url,external) values ('ext','링커리어','https://linkareer.com/list',true);
      insert into user_push_subscriptions(user_id,endpoint,p256dh,auth_secret,created_at)
        values ('${user}','https://fcm.googleapis.com/fcm/send/a','${'A'.repeat(87)}','${'A'.repeat(22)}',now()-interval '3 days'),
               ('${other}','https://fcm.googleapis.com/fcm/send/b','${'A'.repeat(87)}','${'A'.repeat(22)}',now()-interval '3 days');
      insert into user_byok_keys(user_id,ciphertext,key_hint,created_at) values ('${user}','${cipher}','AbCd',now()-interval '1 day');
      insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,changed_at,change_kind,deadline) values
        ('ext/1','ext','1','[회사] 백엔드 인턴','https://linkareer.com/activity/1',current_date,now()-interval '1 hour',now(),'제목',now()+interval '2 days'),
        ('ext/2','ext','2','[회사] 비개발 인턴','https://linkareer.com/activity/2',current_date,now()-interval '1 hour',null,null,null),
        ('ext/3','ext','3','[회사] 확인 필요 인턴','https://linkareer.com/activity/3',current_date,now()-interval '1 hour',null,null,null),
        ('ext/4','ext','4','[회사] 키 등록 전 인턴','https://linkareer.com/activity/4',current_date,now()-interval '2 days',null,null,null);
      insert into user_notice_judgments(user_id,notice_id,verdict,reason,model) values
        ('${user}','ext/1','relevant','서버 개발 직무예요','m'), ('${user}','ext/2','not_relevant','비개발 직무예요','m'),
        ('${user}','ext/3','maybe','자격을 확인해 주세요','m'), ('${user}','ext/4','relevant','오래된 공고예요','m'),
        ('${other}','ext/1','relevant','다른 사람 판정','m');
      set role service_role;`);
    let rows = (await db.query('select * from public.list_notice_push_candidates(20)')).rows;
    assert.deepEqual(rows.map((r) => [r.user_id, r.notice_id, r.kind, r.silent, r.ai_reason]),
      [[user, 'ext/1', 'new_notice', false, '서버 개발 직무예요']], 'no key, no alert for the other user; no changed alert for external');
    assert.equal(rows[0].source_name, '링커리어');
    assert.ok(rows[0].deadline);
    await db.exec("reset role; update user_byok_keys set disabled_at = now(); set role service_role");
    assert.equal((await db.query('select * from public.list_notice_push_candidates(20)')).rows.length, 0, 'a disabled key stops AI alerts');
  } finally { await db.close(); }
});
