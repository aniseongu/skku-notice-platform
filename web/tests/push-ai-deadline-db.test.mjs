import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// 알림 후보의 마감은 화면(withMyDeadline)과 같다: 공지의 마감이 먼저, 없으면 AI가 본문에서 뽑은 내 판정의 날짜와 종류(마감·일정).
// 로그인 화면 알림 예시의 둘째 줄("관심 키워드 인턴, 12월 5일(토) 마감이에요")이 학교 공지에서도 나오게 한다(2026-11-15).
async function setup() {
  const db = new PGlite();
  const user = '00000000-0000-0000-0000-000000000001';
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated; create schema extensions; insert into auth.users values ('${user}');`);
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
  await db.exec(`insert into platform_sources(id,name,url,external) values ('school','학교','https://www.skku.edu/notice',false), ('ext','외부','https://linkareer.com/list',true);
    insert into user_source_subscriptions(user_id,source_id,created_at) values ('${user}','school',now()-interval '2 days');
    insert into user_push_subscriptions(user_id,endpoint,p256dh,auth_secret,created_at)
      values ('${user}','https://fcm.googleapis.com/fcm/send/test','${'A'.repeat(87)}','${'A'.repeat(22)}',now()-interval '2 days');
    insert into platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,body,deadline) values
      ('school/1','school','1','장학 안내','https://www.skku.edu/notice?articleNo=1',current_date,now()-interval '1 hour','본문',null),
      ('school/2','school','2','설명회','https://www.skku.edu/notice?articleNo=2',current_date,now()-interval '1 hour','본문',null),
      ('school/3','school','3','등록 안내','https://www.skku.edu/notice?articleNo=3',current_date,now()-interval '1 hour','본문','2026-12-01T14:59:00Z'),
      ('school/4','school','4','일반 안내','https://www.skku.edu/notice?articleNo=4',current_date,now()-interval '1 hour','본문',null);
    insert into user_notice_judgments(user_id,notice_id,verdict,reason,model,deadline,deadline_kind) values
      ('${user}','school/1','relevant','재학생이 신청할 수 있어요','m','2026-12-05T14:59:00Z','마감'),
      ('${user}','school/2','relevant','누구나 들을 수 있어요','m','2026-12-09T05:00:00Z','일정'),
      ('${user}','school/3','relevant','재학생 대상이에요','m','2026-12-20T14:59:00Z','마감');`);
  return db;
}

test('push candidates carry the AI deadline and its kind when the notice has none, like the app list', async () => {
  const db = await setup();
  try {
    await db.exec('set role service_role');
    const rows = (await db.query('select notice_id, deadline, deadline_kind from public.list_notice_push_candidates(20) order by notice_id')).rows;
    const byId = Object.fromEntries(rows.map((r) => [r.notice_id, r]));
    assert.equal(byId['school/1'].deadline.toISOString(), '2026-12-05T14:59:00.000Z');
    assert.equal(byId['school/1'].deadline_kind, '마감');
    assert.equal(byId['school/2'].deadline_kind, '일정');
    assert.equal(byId['school/3'].deadline.toISOString(), '2026-12-01T14:59:00.000Z');  // 공지의 마감이 먼저
    assert.equal(byId['school/3'].deadline_kind, '마감');
    assert.equal(byId['school/4'].deadline, null);  // 날짜가 없으면 종류도 없다
    assert.equal(byId['school/4'].deadline_kind, null);
    await db.exec('reset role');
    for (const role of ['anon', 'authenticated']) {
      const allowed = (await db.query(`select has_function_privilege('${role}', 'public.list_notice_push_candidates(integer)', 'execute') as ok`)).rows[0].ok;
      assert.equal(allowed, false, role);
    }
  } finally { await db.close(); }
});
