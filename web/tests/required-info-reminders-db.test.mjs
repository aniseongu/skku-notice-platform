import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { EMPTY_PROFILE } from '../src/profile.ts';
import { initialDraft, missingItems, savedDoubleAnswer } from '../src/onboarding-flow.ts';

// 필수 정보 알림(DB 함수 required_info_missing)이 화면의 REQUIRED_ITEMS 판단과 같은지 비교한다.
// REQUIRED_ITEMS를 바꾸면 DB 함수와 이 표도 같이 고친다.
const SW = { college: '소프트웨어융합대학', department: '소프트웨어학과' };
const BIZ = { college: '경영대학', department: '경영학과' };
const ONBOARDED = '2026-11-01T00:00:00Z';
const base = { onboardedAt: ONBOARDED, year: 3, enrollmentStatus: '재학', university3pInternshipSelected: false, university3pInternshipDone: null };
const cases = [
  ['complete non-software', { ...base, programs: [BIZ] }, 'ok', []],
  ['missing primary', { ...base, programs: [] }, 'ok', ['주전공']],
  ['status empty with year: client defaults it to 재학, so not missing', { ...base, programs: [BIZ], enrollmentStatus: null }, 'ok', []],
  ['status and year both empty', { ...base, programs: [BIZ], enrollmentStatus: null, year: null }, 'ok', ['학교 정보']],
  ['missing year while enrolled', { ...base, programs: [BIZ], year: null }, 'ok', ['학교 정보']],
  ['graduated without year', { ...base, programs: [BIZ], year: null, enrollmentStatus: '졸업' }, 'ok', []],
  ['3P unanswered', { ...base, programs: [BIZ], university3pInternshipSelected: null }, 'ok', ['인턴십']],
  ['3P done counts as answered', { ...base, programs: [BIZ], university3pInternshipSelected: null, university3pInternshipDone: true }, 'ok', []],
  ['3P todo answered', { ...base, programs: [BIZ], university3pInternshipSelected: true }, 'ok', []],
  ['SW original missing admission year', { ...base, programs: [SW], deptInternshipDone: false, admissionYear: null }, 'ok', ['인턴십']],
  ['SW original missing dept internship answer', { ...base, programs: [SW], deptInternshipDone: null, admissionYear: 2022 }, 'ok', ['인턴십']],
  ['SW original complete', { ...base, programs: [SW], deptInternshipDone: false, admissionYear: 2022 }, 'ok', []],
  ['SW as double major does not need admission year', { ...base, programs: [BIZ, SW], admissionYear: null, deptInternshipDone: null }, 'ok', []],
  ['AI key none is not required', { ...base, programs: [BIZ] }, 'none', []],
  ['AI key disabled is not required', { ...base, programs: [BIZ] }, 'disabled', []],
  ['AI key one usable of two (groq)', { ...base, programs: [BIZ] }, 'groq-usable', []],
  ['several missing keep list order', { ...base, programs: [], enrollmentStatus: null, year: null, university3pInternshipSelected: null }, 'none', ['주전공', '학교 정보', '인턴십']],
  ['not onboarded is never reminded', { ...base, programs: [], onboardedAt: null }, 'none', []],
];

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated; create schema extensions;`);
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
  return db;
}
const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const lit = (v) => (v === null || v === undefined ? 'null' : typeof v === 'string' ? `'${v}'` : String(v));

async function addUser(db, n, profile, keys = 'ok', device = true) {
  const id = uuid(n);
  await db.exec(`insert into auth.users values ('${id}')`);
  await db.exec(`insert into public.user_profiles(user_id, programs, onboarded_at, year, enrollment_status, admission_year,
      university_3p_internship_selected, university_3p_internship_done, dept_internship_done)
    values ('${id}', '${JSON.stringify(profile.programs)}'::jsonb, ${lit(profile.onboardedAt)}, ${lit(profile.year)}, ${lit(profile.enrollmentStatus)},
      ${lit(profile.admissionYear)}, ${lit(profile.university3pInternshipSelected)}, ${lit(profile.university3pInternshipDone)}, ${lit(profile.deptInternshipDone)})`);
  if (keys === 'ok') await db.exec(`insert into public.user_byok_keys(user_id, ciphertext, key_hint) values ('${id}', '${'c'.repeat(50)}', 'abcd')`);
  if (keys === 'disabled') await db.exec(`insert into public.user_byok_keys(user_id, ciphertext, key_hint, disabled_at) values ('${id}', '${'c'.repeat(50)}', 'abcd', now())`);
  if (keys === 'groq-usable') {
    await db.exec(`insert into public.user_byok_keys(user_id, ciphertext, key_hint, disabled_at) values ('${id}', '${'c'.repeat(50)}', 'abcd', now())`);
    await db.exec(`insert into public.user_ai_keys(user_id, provider, ciphertext, key_hint, model) values ('${id}', 'groq', '${'c'.repeat(50)}', 'abcd', 'openai/gpt-oss-20b')`);
  }
  if (device) await db.exec(`insert into public.user_push_subscriptions(user_id, endpoint, p256dh, auth_secret) values ('${id}', 'https://fcm.googleapis.com/fcm/send/${n}', '${'A'.repeat(87)}', '${'A'.repeat(22)}')`);
  return id;
}

function clientMissing(profile, keys) {
  if (!profile.onboardedAt) return [];
  const full = { ...EMPTY_PROFILE, ...profile };
  const draft = initialDraft(full, [], []);
  const usable = keys === 'ok' || keys === 'groq-usable';
  return missingItems({ draft, doubleAnswer: savedDoubleAnswer(draft), keysUsable: usable }).map((item) => item.label);
}

test('required_info_missing matches the client REQUIRED_ITEMS for every case', async () => {
  const db = await setup();
  try {
    let n = 1;
    for (const [name, profile, keys, expected] of cases) {
      const id = await addUser(db, n++, profile, keys);
      const rows = (await db.query('select public.required_info_missing($1) as m', [id])).rows;
      assert.deepEqual(rows[0].m, expected, `server: ${name}`);
      assert.deepEqual(clientMissing(profile, keys), expected, `client: ${name}`);
    }
    // 프로필 행이 없는 계정도 빈 배열이다.
    await db.exec(`insert into auth.users values ('${uuid(999)}')`);
    assert.deepEqual((await db.query('select public.required_info_missing($1) as m', [uuid(999)])).rows[0].m, []);
  } finally { await db.close(); }
});

test('reminder schedule: up to 3 per missing set, 3 then 7 days apart, new set restarts, devices required', async () => {
  const db = await setup();
  try {
    const profile = { ...base, programs: [BIZ], university3pInternshipSelected: null };
    const id = await addUser(db, 1, profile, 'none');
    const noDevice = await addUser(db, 2, profile, 'none', false);
    const complete = await addUser(db, 3, { ...profile, university3pInternshipSelected: false }, 'none');
    const list = async () => (await db.query('select user_id, missing, missing_key from public.list_required_info_reminders(20)')).rows;
    const age = (days) => db.exec(`update public.user_required_reminders set last_sent_at = now() - interval '${days} days', last_tried_at = now() - interval '${days} days' where user_id = '${id}'`);
    const mark = (key) => db.query('select public.mark_required_reminder($1, $2)', [id, key]);

    let rows = await list();
    assert.deepEqual(rows.map((r) => [r.user_id, r.missing, r.missing_key]), [[id, ['인턴십'], '인턴십']]);  // 기기 없는 계정·다 채운 계정 제외
    assert.ok(!rows.some((r) => r.user_id === noDevice || r.user_id === complete));

    await mark('인턴십');
    assert.equal((await list()).length, 0);          // 방금 보냄
    await age(2); assert.equal((await list()).length, 0);
    await age(3); assert.equal((await list()).length, 1);   // 3일 뒤 두 번째
    await mark('인턴십');
    await age(6); assert.equal((await list()).length, 0);
    await age(7); assert.equal((await list()).length, 1);   // 7일 뒤 세 번째
    await mark('인턴십');
    assert.equal((await db.query('select sends from public.user_required_reminders where user_id = $1', [id])).rows[0].sends, 3);
    await age(365); assert.equal((await list()).length, 0);  // 세 번이면 끝

    // 모두 실패한 시도는 보낸 횟수를 세지 않고 1시간 쉰 뒤 목록 뒤쪽에서 다시 나온다(실패한 계정이 앞자리를 계속 차지하지 않게).
    const other = await addUser(db, 4, profile, 'none');
    await db.query('select public.touch_required_reminder($1, $2)', [other, '인턴십']);
    assert.equal((await list()).some((r) => r.user_id === other), false);
    await db.exec(`update public.user_required_reminders set last_tried_at = now() - interval '2 hours' where user_id = '${other}'`);
    assert.equal((await db.query('select sends from public.user_required_reminders where user_id = $1', [other])).rows[0].sends, 0);
    assert.equal((await list()).some((r) => r.user_id === other), true);
    await db.exec(`delete from public.user_push_subscriptions where user_id = '${other}'`);

    // 빈 항목이 달라지면 새 묶음이라 처음부터 다시 보낸다.
    await db.exec(`update public.user_profiles set year = null where user_id = '${id}'`);
    rows = await list();
    assert.deepEqual(rows.map((r) => r.missing_key), ['학교 정보,인턴십']);

    // 빈 항목을 채우면 목록에서 빠진다. AI 키는 필수가 아니라 키가 없어도 빠진다.
    await db.exec(`update public.user_profiles set university_3p_internship_selected = false, year = 3 where user_id = '${id}'`);
    assert.equal((await list()).length, 0);
  } finally { await db.close(); }
});

test('only the service role can run the reminder functions and read the reminder table', async () => {
  const db = await setup();
  try {
    const fns = ['required_info_missing(uuid)', 'list_required_info_reminders(integer)', 'mark_required_reminder(uuid, text)', 'touch_required_reminder(uuid, text)'];
    for (const role of ['anon', 'authenticated']) {
      for (const fn of fns) {
        const ok = (await db.query(`select has_function_privilege('${role}', 'public.${fn}', 'execute') as ok`)).rows[0].ok;
        assert.equal(ok, false, `${role} ${fn}`);
      }
      const read = (await db.query(`select has_table_privilege('${role}', 'public.user_required_reminders', 'select') as ok`)).rows[0].ok;
      assert.equal(read, false, role);
    }
    for (const fn of fns) assert.equal((await db.query(`select has_function_privilege('service_role', 'public.${fn}', 'execute') as ok`)).rows[0].ok, true, fn);
    assert.equal((await db.query(`select relrowsecurity from pg_class where relname = 'user_required_reminders'`)).rows[0].relrowsecurity, true);
  } finally { await db.close(); }
});

test('migration 20261118120000 drops the AI key from old reminder history and keeps sent counts', async () => {
  const db = await setup();
  try {
    const profile = { ...base, programs: [BIZ] };
    const a = await addUser(db, 1, profile, 'none'), b = await addUser(db, 2, profile, 'none'), c = await addUser(db, 3, profile, 'none');
    const seed = async () => {
      await db.exec('delete from public.user_required_reminders');
      await db.exec(`insert into public.user_required_reminders(user_id, missing_key, sends, last_sent_at) values
        ('${a}', 'AI 키', 2, now()), ('${b}', '인턴십,AI 키', 1, now()), ('${c}', '인턴십,AI 키', 3, now()), ('${c}', '인턴십', 1, now())`);
    };
    await seed();
    const dir = new URL('../../supabase/migrations/', import.meta.url);
    const sql = await readFile(new URL('20261118120000_required_info_without_ai_key.sql', dir), 'utf8');
    await db.exec(sql);
    await db.exec(sql);   // 멱등
    const rows = (await db.query('select user_id, missing_key, sends from public.user_required_reminders order by user_id')).rows;
    assert.deepEqual(rows.map((r) => [r.user_id, r.missing_key, r.sends]), [[b, '인턴십', 1], [c, '인턴십', 1]]);
  } finally { await db.close(); }
});
