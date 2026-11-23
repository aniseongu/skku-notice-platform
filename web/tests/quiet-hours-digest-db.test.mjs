import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const alice = '00000000-0000-0000-0000-000000000001';
const bob = '00000000-0000-0000-0000-000000000002';
const phone = '10000000-0000-0000-0000-000000000001';
const laptop = '10000000-0000-0000-0000-000000000002';
const bobPhone = '10000000-0000-0000-0000-000000000003';
const start = '2026-11-22T14:00:00Z'; // 23:00 KST
const morning = '2026-11-23T00:00:00Z'; // 09:00 KST
const end = '2026-11-23T04:00:00Z'; // 13:00 KST

test('quiet-hour preferences isolate accounts and default to ordinary delivery', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const rows = async (sql, params) => (await db.query(sql, params)).rows;
  const regular = () => rows('select * from public.list_notice_push_candidates(100)');
  const reminders = (now) => rows('select * from public.list_saved_deadline_reminders(20, $1)', [now]);
  const stage = (now, limit) => limit === undefined
    ? rows('select public.defer_quiet_pushes($1)', [now])
    : rows('select public.defer_quiet_pushes($1, $2)', [now, limit]);
  const claim = (now, limit = 20) => rows('select * from public.claim_deferred_pushes($1, $2)', [limit, now]);
  const mark = (token, status) => rows('select public.mark_deferred_pushes($1, $2)', [token, status]);

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema extensions;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    insert into auth.users values ('${alice}'), ('${bob}');
  `);
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  // Add a preference row before the new columns exist to exercise the upgrade default.
  for (const file of (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort()) {
    if (file === '20261123120000_quiet_hours_digest.sql') {
      await db.query('insert into public.user_preferences(user_id, keywords) values ($1, $2)', [alice, ['공지']]);
    }
    await db.exec(await readFile(new URL(file, dir), 'utf8'));
  }
  await db.exec(`
    insert into public.platform_sources(id,name,url) values ('school','학교 공지','https://www.skku.edu/notice');
    insert into public.user_source_subscriptions(user_id,source_id,notifications_enabled,created_at)
      values ('${alice}','school',true,now()-interval '1 day'), ('${bob}','school',true,now()-interval '1 day');
    insert into public.user_push_subscriptions(id,user_id,endpoint,p256dh,auth_secret,created_at)
      values ('${phone}','${alice}','https://fcm.googleapis.com/fcm/send/a',repeat('A',87),repeat('A',22),now()-interval '1 day'),
             ('${laptop}','${alice}','https://fcm.googleapis.com/fcm/send/b',repeat('A',87),repeat('A',22),now()-interval '1 day'),
             ('${bobPhone}','${bob}','https://fcm.googleapis.com/fcm/send/c',repeat('A',87),repeat('A',22),now()-interval '1 day');
    insert into public.platform_notices(id,source_id,article_no,title,url,posted_on,first_seen,changed_at,change_kind,deadline)
    select 'school/'||i, 'school', i::text, '공지 '||i, 'https://www.skku.edu/notice/'||i,
           (now() at time zone 'Asia/Seoul')::date, now()-interval '2 minutes',
           case when i=1 then now()-interval '1 minute' end,
           case when i=1 then '제목' end,
           case when i=2 then '2026-11-24T10:00:00Z'::timestamptz end
    from generate_series(1, 24) i;
    insert into public.user_notice_states(user_id,notice_id,is_saved)
      values ('${alice}','school/2',true), ('${bob}','school/2',true);
    set timezone to 'America/Los_Angeles';
  `);

  await t.test('KST inclusive start, exclusive end and both window shapes', async () => {
    const cases = [
      [null, null, morning, false],
      ['23:00', '13:00', '2026-11-22T13:59:59Z', false],
      ['23:00', '13:00', start, true],
      ['23:00', '13:00', '2026-11-22T15:00:00Z', true],
      ['23:00', '13:00', morning, true],
      ['23:00', '13:00', end, false],
      ['23:00', '08:00', '2026-11-22T22:59:59Z', true],
      ['23:00', '08:00', '2026-11-22T23:00:00Z', false],
      ['09:00', '12:00', morning, true],
      ['09:00', '12:00', '2026-11-23T03:00:00Z', false],
    ];
    for (const [from, to, now, expected] of cases) {
      const [{ quiet }] = await rows('select public.push_quiet_now($1, $2, $3) as quiet', [from, to, now]);
      assert.equal(quiet, expected, String(now));
    }
  });

  await t.test('existing and new defaults, paired time checks, RLS and service-only RPCs', async () => {
    const functions = await rows(`
      select p.proname, p.prosecdef, p.proconfig,
             has_function_privilege('service_role', p.oid, 'execute') as service,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authenticated
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public'
        and p.proname in ('defer_quiet_pushes','claim_deferred_pushes','mark_deferred_pushes')
    `);
    assert.equal(functions.length, 3);
    for (const fn of functions) {
      assert.equal(fn.prosecdef, true);
      assert.deepEqual(fn.proconfig, ['search_path=""']);
      assert.equal(fn.service, true);
      assert.equal(fn.anon, false);
      assert.equal(fn.authenticated, false);
    }

    await db.exec('set role authenticated');
    await rows("select set_config('request.jwt.claim.sub', $1, false)", [bob]);
    assert.deepEqual(await rows('select quiet_start, quiet_end from public.user_preferences'), []);
    assert.deepEqual(await rows(
      'insert into public.user_preferences(user_id) values ($1) returning quiet_start, quiet_end', [bob],
    ), [{ quiet_start: null, quiet_end: null }]);
    assert.deepEqual(await rows(
      "update public.user_preferences set quiet_start='21:00', quiet_end='08:00' where user_id=$1 returning user_id",
      [alice],
    ), []);
    assert.deepEqual(await rows('delete from public.user_preferences where user_id=$1 returning user_id', [alice]), []);
    await assert.rejects(stage(start), { code: '42501' });

    await rows("select set_config('request.jwt.claim.sub', $1, false)", [alice]);
    assert.deepEqual(await rows('select quiet_start, quiet_end from public.user_preferences'),
      [{ quiet_start: null, quiet_end: null }]);
    for (const [from, to, code] of [['23:00', null, '23514'], ['08:00', '08:00', '23514'],
      ['24:00', '08:00', '23514'], ['25:00', '08:00', '22008']]) {
      await assert.rejects(
        rows('update public.user_preferences set quiet_start=$1, quiet_end=$2', [from, to]), { code },
      );
    }
    assert.deepEqual(await rows(
      "update public.user_preferences set quiet_start='23:00', quiet_end='08:00' returning user_id",
    ), [{ user_id: alice }]);
    await db.exec('update public.user_preferences set quiet_start=null, quiet_end=null');
    await db.exec('set role anon');
    await assert.rejects(claim(end), { code: '42501' });
    await assert.rejects(rows('select quiet_start from public.user_preferences'), { code: '42501' });

    await db.exec('set role service_role');
    await stage(morning);
    assert.deepEqual(await claim(end), []);
    assert.equal((await regular()).length, 74);
    assert.equal((await reminders(morning)).length, 3);
  });

  await t.test('coalesces new, changed and saved reminders per device and records sent once', async () => {
    await db.exec(`reset role;
      update public.user_preferences
        set quiet_start=((now()-interval '1 hour') at time zone 'Asia/Seoul')::time,
            quiet_end=((now()+interval '1 hour') at time zone 'Asia/Seoul')::time
        where user_id='${alice}';
      set role service_role;`);
    assert.deepEqual((await rows('select distinct user_id from public.list_notice_push_candidates(20)')),
      [{ user_id: bob }]);
    assert.deepEqual(await rows("select public.claim_notice_push($1,$2,'school/1') as id", [alice, phone]),
      [{ id: null }]);

    await db.exec(`reset role;
      update public.user_preferences set quiet_start='23:00', quiet_end='13:00' where user_id='${alice}';
      set role service_role;`);
    await stage(start);
    await stage(morning);
    await stage(morning);
    assert.deepEqual((await reminders(morning)).map(({ user_id }) => user_id), [bob]);
    assert.deepEqual(await rows(
      "select public.claim_saved_deadline_reminder($1,$2,'school/2',1,$3) as claim", [alice, phone, morning],
    ), [{ claim: null }]);
    assert.deepEqual(await claim('2026-11-23T03:59:59Z'), []);
    assert.equal((await regular()).filter((row) => row.user_id === alice).length, 0);

    assert.deepEqual(await reminders(end), []);
    const [first] = await claim(end, 1);
    const [second] = await claim(end, 1);
    const groups = [first, second];
    assert.deepEqual(new Set(groups.map((g) => g.candidates[0].subscription_id)), new Set([phone, laptop]));
    for (const { candidates } of groups) {
      assert.equal(candidates.length, 26);
      assert.ok(candidates.every((c) => c.user_id === alice && c.subscription_id === candidates[0].subscription_id));
      assert.equal(candidates.filter((c) => c.kind === 'changed').length, 1);
      assert.deepEqual(candidates.filter((c) => c.days_before === 1)
        .map(({ notice_id, days_remaining }) => ({ notice_id, days_remaining })),
      [{ notice_id: 'school/2', days_remaining: 1 }]);
    }
    assert.deepEqual(await claim(end), []);
    await mark(first.claim_token, 'sent');
    await mark(second.claim_token, 'failed');
    assert.deepEqual(await claim(end), []);

    await db.exec(`reset role;
      update public.user_notification_history set updated_at=now()-interval '31 minutes' where status='failed';
      update public.saved_deadline_reminder_history set updated_at=now()-interval '31 minutes' where status='failed';
      set role service_role;`);
    const [retry] = await claim(end);
    assert.equal(retry.candidates.length, 26);
    assert.notEqual(retry.claim_token, second.claim_token);
    await mark(second.claim_token, 'failed');
    await mark(retry.claim_token, 'sent');
    assert.deepEqual(await claim(end), []);
    assert.deepEqual(await rows(
      "select count(*)::int from public.user_notification_history where status='sent' and user_id=$1", [alice],
    ), [{ count: 50 }]);
    await db.exec('reset role');
    assert.deepEqual(await rows(
      "select count(*)::int from public.saved_deadline_reminder_history where status='sent' and user_id=$1", [alice],
    ), [{ count: 2 }]);
  });

  await t.test('the staging limit is shared and turning off quiet hours releases the next run', async () => {
    await db.exec('begin');
    try {
      await rows("update public.user_preferences set quiet_start='23:00', quiet_end='13:00' where user_id=$1", [bob]);
      await db.exec('set local role service_role');
      await stage(morning, 2);
      assert.deepEqual(await claim(morning), []);

      await db.exec('reset role');
      await rows('update public.user_preferences set quiet_start=null, quiet_end=null where user_id=$1', [bob]);
      await db.exec('set local role service_role');
      const nextRun = '2026-11-23T00:30:00Z'; // 09:30 KST, still within the original quiet window
      await stage(nextRun, 2);
      const [group] = await claim(nextRun);
      assert.equal(group.candidates.length, 2);
      assert.ok(group.candidates.every((candidate) => candidate.subscription_id === bobPhone));
      assert.equal(group.candidates.filter((candidate) => candidate.days_before === 1).length, 1);
      await mark(group.claim_token, 'sent');
      assert.deepEqual(await claim(nextRun), []);
    } finally {
      await db.exec('rollback');
    }
  });

  await t.test('a deferred saved reminder is never claimed after the notice is unsaved', async () => {
    await rows("update public.user_preferences set quiet_start='23:00', quiet_end='13:00' where user_id=$1", [bob]);
    await db.exec('set role service_role');
    await stage(morning, 1);
    await db.exec('reset role');
    const history = () => rows(
      'select attempt_count, status from public.saved_deadline_reminder_history where user_id=$1 and deferred_at is not null',
      [bob],
    );
    const deferred = [{ attempt_count: 0, status: 'pending' }];
    assert.deepEqual(await history(), deferred);
    await rows("update public.user_notice_states set is_saved=false where user_id=$1 and notice_id='school/2'", [bob]);
    await db.exec('set role service_role');
    assert.deepEqual(await claim(end), []);
    await db.exec('reset role');
    assert.deepEqual(await history(), deferred);
  });
});
