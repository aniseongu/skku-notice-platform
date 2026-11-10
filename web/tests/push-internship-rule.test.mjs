import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const U = '00000000-0000-0000-0000-000000000001';
const MIGRATIONS = ['20261107030000_public_notices.sql', '20261107031000_notice_changes.sql', '20261107040000_user_subscriptions.sql',
  '20261107050000_user_notice_states.sql', '20261107060000_user_preferences.sql', '20261107070000_public_ocr_cache.sql',
  '20261107080000_push_subscriptions.sql', '20261107081000_push_claims.sql', '20261107082000_push_candidates.sql',
  '20261107100000_push_silent_priority.sql', '20261107101000_push_original_content.sql', '20261107110000_user_byok.sql',
  '20261107111000_source_external_flag.sql', '20261107112000_byok_judging.sql', '20261107113000_push_ai_candidates.sql',
  '20261108110000_school_judging.sql', '20261110110000_push_internship_not_relevant.sql', '20261110120000_push_changed_and_wait.sql'];

test('an internship-titled school post the AI judged not relevant is not pushed, even when a keyword matches (same as the original)', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated; insert into auth.users values ('${U}');`);
    for (const name of MIGRATIONS) await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    await db.exec(`insert into platform_sources(id,name,url) values ('school','학교','https://www.skku.edu/n');
      insert into user_source_subscriptions(user_id,source_id,created_at) values ('${U}','school',now()-interval '2 days');
      insert into user_push_subscriptions(user_id,endpoint,p256dh,auth_secret,created_at)
        values ('${U}','https://fcm.googleapis.com/fcm/send/a','${'A'.repeat(87)}','${'A'.repeat(22)}',now()-interval '2 days');
      insert into user_preferences(user_id,keywords) values ('${U}',array['인턴']);
      insert into user_byok_keys(user_id,ciphertext,key_hint,created_at) values ('${U}','${'c'.repeat(60)}','abcd',now()-interval '1 day');
      insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,fetched_at,body) values
        ('school/1','school','1','겨울 인턴 모집','https://www.skku.edu/1',current_date,now()-interval '1 hour',now(),'인턴'),
        ('school/2','school','2','Summer Internship Program','https://www.skku.edu/2',current_date,now()-interval '1 hour',now(),'intern'),
        ('school/3','school','3','인턴 설명회','https://www.skku.edu/3',current_date,now()-interval '1 hour',now(),'인턴'),
        ('school/4','school','4','장학금 안내','https://www.skku.edu/4',current_date,now()-interval '1 hour',now(),'장학'),
        ('school/5','school','5','Internal audit notice','https://www.skku.edu/5',current_date,now()-interval '1 hour',now(),'x');
      insert into user_notice_judgments(user_id,notice_id,verdict,reason,model) values
        ('${U}','school/1','not_relevant','관련 없음','m'), ('${U}','school/2','not_relevant','관련 없음','m'),
        ('${U}','school/3','relevant','관련 있음','m'), ('${U}','school/4','not_relevant','관련 없음','m'),
        ('${U}','school/5','not_relevant','관련 없음','m');
      set role service_role;`);
    const rows = (await db.query('select notice_id, silent from public.list_notice_push_candidates(20) order by notice_id')).rows;
    // 1, 2: 인턴/internship 제목 + 관련 없음 → 보내지 않음. 3: 관련 있음 → 보냄. 4: 인턴이 아닌 글은 관련 없어도 무음으로 보냄. 5: "Internal"은 intern 낱말이 아니다.
    assert.deepEqual(rows.map((r) => r.notice_id), ['school/3', 'school/4', 'school/5']);
    assert.equal(rows.find((r) => r.notice_id === 'school/3').silent, false);
    assert.equal(rows.find((r) => r.notice_id === 'school/4').silent, true);
  } finally { await db.close(); }
});

async function seeded(extra) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated; insert into auth.users values ('${U}');`);
  for (const name of MIGRATIONS) await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  await db.exec(`insert into platform_sources(id,name,url) values ('school','학교','https://www.skku.edu/n');
    insert into user_source_subscriptions(user_id,source_id,created_at) values ('${U}','school',now()-interval '2 days');
    insert into user_push_subscriptions(user_id,endpoint,p256dh,auth_secret,created_at)
      values ('${U}','https://fcm.googleapis.com/fcm/send/a','${'A'.repeat(87)}','${'A'.repeat(22)}',now()-interval '2 days');
    insert into user_byok_keys(user_id,ciphertext,key_hint,created_at) values ('${U}','${'c'.repeat(60)}','abcd',now()-interval '1 day');
    ${extra}
    set role service_role;`);
  return db;
}

test('a user with a key waits up to three hours for the judgment, then the post goes out silently', async () => {
  const db = await seeded(`insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,fetched_at,body) values
    ('school/1','school','1','판정 기다리는 글','https://www.skku.edu/1',current_date,now()-interval '2 hours',now(),'본문'),
    ('school/2','school','2','오래 기다린 글','https://www.skku.edu/2',current_date,now()-interval '4 hours',now(),'본문');`);
  try {
    const rows = (await db.query('select notice_id, silent from public.list_notice_push_candidates(20) order by notice_id')).rows;
    assert.deepEqual(rows, [{ notice_id: 'school/2', silent: true }]);
  } finally { await db.close(); }
});

test('an edited post is pushed when the AI judged it relevant or maybe, not when it judged it not relevant (same as the original is_mine)', async () => {
  const db = await seeded(`insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,fetched_at,body,changed_at,change_kind) values
    ('school/1','school','1','고친 글 하나','https://www.skku.edu/1',current_date,now()-interval '1 day',now(),'본문',now()-interval '1 hour','본문'),
    ('school/2','school','2','고친 글 둘','https://www.skku.edu/2',current_date,now()-interval '1 day',now(),'본문',now()-interval '1 hour','본문'),
    ('school/3','school','3','고친 글 셋','https://www.skku.edu/3',current_date,now()-interval '1 day',now(),'본문',now()-interval '1 hour','본문');
    insert into user_notice_judgments(user_id,notice_id,verdict,reason,model) values
      ('${U}','school/1','relevant','r','m'), ('${U}','school/2','maybe','r','m'), ('${U}','school/3','not_relevant','r','m');
    insert into user_notification_history(subscription_id,user_id,notice_id,kind,change_marker,status)
      select id,user_id,n,'new_notice','epoch','sent' from user_push_subscriptions, (values ('school/1'),('school/2'),('school/3')) v(n);`);
  try {
    const rows = (await db.query("select notice_id from public.list_notice_push_candidates(20) where kind = 'changed' order by notice_id")).rows;
    assert.deepEqual(rows.map((r) => r.notice_id), ['school/1', 'school/2']);
  } finally { await db.close(); }
});
