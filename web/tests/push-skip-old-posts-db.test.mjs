import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// (posted_on은 NOT NULL 열이라 null 경우는 DB에서 만들 수 없고, 조건의 is null 분기는 방어용이다.)
// 처음 수집된 날보다 게시일이 3일 넘게 앞선 옛 글은 새 글 알림 후보가 아니다(수정됨 알림은 그대로).
test('old posts are skipped for new-notice pushes only', async () => {
  const db = new PGlite();
  const user = '00000000-0000-0000-0000-000000000001';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated; create schema extensions; insert into auth.users values ('${user}');`);
    const dir = new URL('../../supabase/migrations/', import.meta.url);
    for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
    const seoulToday = "(now() at time zone 'Asia/Seoul')::date";
    await db.exec(`insert into platform_sources(id,name,url,external) values ('school','학교','https://www.skku.edu/notice',false);
      insert into user_source_subscriptions(user_id,source_id,created_at) values ('${user}','school',now()-interval '2 days');
      insert into user_push_subscriptions(user_id,endpoint,p256dh,auth_secret,created_at)
        values ('${user}','https://fcm.googleapis.com/fcm/send/test','${'A'.repeat(87)}','${'A'.repeat(22)}',now()-interval '2 days');
      insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,body) values
        ('school/1','school','1','옛 글','https://www.skku.edu/notice?articleNo=1',${seoulToday}-30,now()-interval '1 hour','본문 글자'),
        ('school/2','school','2','오늘 글','https://www.skku.edu/notice?articleNo=2',${seoulToday},now()-interval '1 hour','본문 글자'),
        ('school/3','school','3','어제 글','https://www.skku.edu/notice?articleNo=3',${seoulToday}-1,now()-interval '1 hour','본문 글자'),
        ('school/4','school','4','3일 전 글','https://www.skku.edu/notice?articleNo=4',${seoulToday}-3,now()-interval '1 hour','본문 글자'),
        ('school/5','school','5','4일 전 글','https://www.skku.edu/notice?articleNo=5',${seoulToday}-4,now()-interval '1 hour','본문 글자');`);
    const rows = async () => { await db.exec('set role service_role'); const r = (await db.query('select notice_id, kind from public.list_notice_push_candidates(50)')).rows; await db.exec('reset role'); return r; };
    const ids = (r, k) => r.filter((x) => x.kind === k).map((x) => x.notice_id).sort();
    let r = await rows();
    assert.deepEqual(ids(r, 'new_notice'), ['school/2', 'school/3', 'school/4']);
    await db.exec(`insert into user_preferences(user_id,keywords) values ('${user}', array['옛']); update platform_notices set changed_at = now(), change_kind = '본문' where id = 'school/1'`);
    r = await rows();
    assert.deepEqual(ids(r, 'changed'), ['school/1']);
    assert.ok(!ids(r, 'new_notice').includes('school/1'));
  } finally { await db.close(); }
});
