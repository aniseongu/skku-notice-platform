import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const alice = '00000000-0000-0000-0000-000000000001';
const bob = '00000000-0000-0000-0000-000000000002';
const alicePhone = '10000000-0000-0000-0000-000000000001';
const aliceLaptop = '10000000-0000-0000-0000-000000000002';
const bobPhone = '10000000-0000-0000-0000-000000000003';
const morning = '2026-11-23T00:00:00Z';

test('saved deadline reminders use account saves, KST dates, service-only claims and bounded retries', async () => {
  const db = new PGlite();
  const rows = async (sql, params) => (await db.query(sql, params)).rows;
  const candidates = (now = morning) => rows(
    'select * from public.list_saved_deadline_reminders(20, $1)', [now],
  );
  const claim = async (user, device, notice, days, now = morning) => (await rows(
    'select public.claim_saved_deadline_reminder($1, $2, $3, $4, $5) as claim',
    [user, device, `school/${notice}`, days, now],
  ))[0].claim;
  const mark = (value, status) => db.query('select public.mark_saved_deadline_reminder($1, $2, $3)', [
    value.claim_id, value.attempt_count, status,
  ]);

  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create schema extensions; insert into auth.users values ('${alice}'), ('${bob}');`);
    const dir = new URL('../../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(file, dir), 'utf8'));
    }
    await db.exec(`
      insert into public.platform_sources(id,name,url) values ('school','학교 공지','https://www.skku.edu/notice');
      insert into public.user_source_subscriptions(user_id,source_id,notifications_enabled) values ('${alice}','school',false);
      insert into public.user_push_subscriptions(id,user_id,endpoint,p256dh,auth_secret,alert_all_new)
        values ('${alicePhone}','${alice}','https://fcm.googleapis.com/fcm/send/a','${'A'.repeat(87)}','${'A'.repeat(22)}',false),
               ('${aliceLaptop}','${alice}','https://fcm.googleapis.com/fcm/send/b','${'A'.repeat(87)}','${'A'.repeat(22)}',true),
               ('${bobPhone}','${bob}','https://fcm.googleapis.com/fcm/send/c','${'A'.repeat(87)}','${'A'.repeat(22)}',false);
      insert into public.platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,deadline)
      select 'school/' || num, 'school', num::text, '안내 ' || num, 'https://www.skku.edu/notice/' || num,
             '2026-11-20', '2026-11-20T00:00:00Z', deadline::timestamptz
      from (values
        (1,'2026-11-25T15:00:00Z'), -- Nov 26 00:00 KST, D-3
        (2,null),                 -- A different AI deadline for Alice and Bob
        (3,null),                 -- AI event
        (4,'2026-11-24T14:59:00Z'), -- applied
        (5,'2026-11-24T14:59:00Z'), -- result
        (6,'2026-11-24T14:59:00Z'), -- unsaved, opportunity kept
        (7,null),                 -- no deadline
        (8,'2026-11-22T14:59:00Z'), -- expired
        (9,'2026-11-23T14:59:00Z'), -- today, D-1 missed
        (10,'2026-11-25T14:59:59Z'), -- Nov 25 23:59 KST, D-3 missed
        (11,null)                 -- AI deadline with uncertain kind
      ) n(num, deadline);
      insert into public.user_notice_states(user_id,notice_id,is_saved)
      select '${alice}', id, id <> 'school/6' from public.platform_notices where source_id = 'school';
      insert into public.user_notice_states(user_id,notice_id,is_saved) values ('${bob}','school/2',true);
      insert into public.user_opportunities(user_id,notice_id,title,status) values
        ('${alice}','school/2','준비','preparing'), ('${alice}','school/4','지원','applied'),
        ('${alice}','school/5','결과','result'), ('${alice}','school/6','기회함 기록','interested');
      insert into public.user_notice_judgments(user_id,notice_id,verdict,reason,model,deadline,deadline_kind) values
        ('${alice}','school/1','maybe','직접 확인해요','m','2026-11-24T14:59:00Z',null),
        ('${alice}','school/2','maybe','직접 확인해요','m','2026-11-23T15:00:00Z','마감'),
        ('${bob}','school/2','relevant','신청할 수 있어요','m','2026-11-25T15:00:00Z','마감'),
        ('${alice}','school/3','maybe','행사예요','m','2026-11-24T00:00:00Z','일정'),
        ('${alice}','school/11','maybe','불확실해요','m','2026-11-24T00:00:00Z',null);
      set role service_role;
      set timezone to 'America/Los_Angeles';
    `);

    const expected = [
      [alicePhone, 'school/2', 1], [aliceLaptop, 'school/2', 1],
      [alicePhone, 'school/1', 3], [aliceLaptop, 'school/1', 3], [bobPhone, 'school/2', 3],
    ];
    const summarize = (items) => items.map((r) => [r.subscription_id, r.notice_id, r.days_before]);
    const initialCandidates = await candidates();
    assert.deepEqual(summarize(initialCandidates), expected);
    assert.equal(initialCandidates.some((r) => r.notice_id === 'school/11'), false);
    assert.ok(initialCandidates.some((r) => r.user_id === alice && r.notice_id === 'school/1'));
    assert.deepEqual(summarize(await candidates('2026-11-23T02:59:59Z')), expected);
    for (const outside of ['2026-11-22T15:00:00Z', '2026-11-22T23:59:59Z', '2026-11-23T03:00:00Z']) {
      assert.deepEqual(await candidates(outside), []);
      assert.equal(await claim(alice, alicePhone, 1, 3, outside), null);
    }
    assert.equal(await claim(alice, bobPhone, 2, 1), null);
    assert.equal(await claim(alice, alicePhone, 5, 1), null);
    assert.equal(await claim(alice, alicePhone, 1, 1), null);

    const phone = await claim(alice, alicePhone, 1, 3);
    assert.equal(phone.user_id, alice);
    assert.equal(phone.silent, true);
    assert.equal(phone.attempt_count, 1);
    assert.equal(await claim(alice, alicePhone, 1, 3), null);
    const laptop = await claim(alice, aliceLaptop, 1, 3);
    assert.equal(laptop.silent, false);
    assert.notEqual(laptop.claim_id, phone.claim_id);
    await mark(laptop, 'sent');
    await mark(phone, 'failed');
    assert.equal(await claim(alice, alicePhone, 1, 3), null);
    assert.equal(await claim(alice, aliceLaptop, 1, 3), null);
    const ageHistory = async (id, interval) => {
      await db.exec('reset role');
      await db.query('update public.saved_deadline_reminder_history set updated_at = now() - $2::interval where id = $1', [id, interval]);
      await db.exec('set role service_role');
    };
    await ageHistory(phone.claim_id, '31 minutes');
    await ageHistory(laptop.claim_id, '31 minutes');
    assert.equal(await claim(alice, aliceLaptop, 1, 3), null);
    const retry = await claim(alice, alicePhone, 1, 3);
    assert.equal(retry.claim_id, phone.claim_id);
    assert.equal(retry.attempt_count, 2);
    await mark(phone, 'sent'); // A stale worker cannot finish the new attempt.
    await ageHistory(phone.claim_id, '31 minutes');
    const last = await claim(alice, alicePhone, 1, 3);
    assert.equal(last.attempt_count, 3);
    await ageHistory(phone.claim_id, '31 minutes');
    assert.equal(await claim(alice, alicePhone, 1, 3), null);
    assert.ok((await claim(alice, alicePhone, 1, 1, '2026-11-25T00:00:00Z')).claim_id);

    await db.exec('reset role');
    await db.exec(`update public.user_opportunities set status = 'applied' where user_id = '${alice}' and notice_id = 'school/2'`);
    await db.exec('set role service_role');
    assert.equal(await claim(alice, alicePhone, 2, 1), null);
    assert.equal((await claim(bob, bobPhone, 2, 3)).silent, false);
    await ageHistory(phone.claim_id, '91 days');
    assert.equal((await rows("select public.purge_expired_data()->>'saved_deadline_reminders' as purged"))[0].purged, '1');

    await db.exec('reset role');
    const roles = ['anon', 'authenticated', 'service_role'];
    const functions = [
      'list_saved_deadline_reminders(integer,timestamptz)',
      'claim_saved_deadline_reminder(uuid,uuid,text,integer,timestamptz)',
      'mark_saved_deadline_reminder(bigint,integer,text)',
      'purge_expired_data(integer,integer,integer)',
    ];
    for (const role of roles) {
      assert.equal((await rows(
        "select has_table_privilege($1, 'public.saved_deadline_reminder_history', 'SELECT,INSERT,UPDATE,DELETE') as ok", [role],
      ))[0].ok, false);
      assert.equal((await rows(
        "select has_table_privilege($1, 'public.saved_deadline_reminder_notices', 'SELECT') as ok", [role],
      ))[0].ok, false);
      for (const signature of functions) {
        assert.equal((await rows('select has_function_privilege($1, $2, $3) as ok', [
          role, `public.${signature}`, 'EXECUTE',
        ]))[0].ok, role === 'service_role');
      }
    }
    assert.equal((await rows("select relrowsecurity from pg_class where oid = 'public.saved_deadline_reminder_history'::regclass"))[0].relrowsecurity, true);
  } finally {
    await db.close();
  }
});
