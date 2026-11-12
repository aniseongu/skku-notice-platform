import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_PROFILE, loadProfile, parsePrograms, saveProfile, validateProfile } from '../src/profile.ts';
import { COLLEGES, findCollege, programKey, programLabel, validProgram } from '../src/skku-programs.ts';

const base = { ...EMPTY_PROFILE };

test('college list has unique names and non-empty unique departments', () => {
  assert.equal(new Set(COLLEGES.map((c) => c.name)).size, COLLEGES.length);
  const all = COLLEGES.flatMap((c) => c.departments.map((d) => `${c.name}/${d}`));
  assert.equal(new Set(all).size, all.length);
  assert.ok(COLLEGES.every((c) => c.departments.every((d) => d.trim() === d && d.length > 0 && d.length <= 40)));
  assert.deepEqual(findCollege('소프트웨어융합대학').departments.slice(0, 2), ['소프트웨어학과', '글로벌융합학부']);
  assert.equal(findCollege('없는대학'), undefined);
});

test('a program needs a department of its own college, except colleges without departments', () => {
  assert.equal(validProgram({ college: '자연과학대학', department: '물리학과' }), true);
  assert.equal(validProgram({ college: '자연과학대학', department: '국어국문학과' }), false);
  assert.equal(validProgram({ college: '자연과학대학', department: null }), false);
  assert.equal(validProgram({ college: '학부대학', department: null }), true);
  assert.equal(validProgram({ college: '학부대학', department: '물리학과' }), false);
  assert.equal(programLabel({ college: '학부대학', department: null }), '학부대학');
  assert.notEqual(programKey({ college: 'a', department: 'b' }), programKey({ college: 'ab', department: '' }));
});

test('double majors across colleges are accepted, duplicates and more than four are not', () => {
  const sw = { college: '소프트웨어융합대학', department: '소프트웨어학과' };
  const biz = { college: '경영대학', department: '경영학과' };
  assert.doesNotThrow(() => validateProfile({ ...base, programs: [sw, biz] }));
  assert.throws(() => validateProfile({ ...base, programs: [sw, sw] }), /확인/);
  const five = ['국어국문학과', '영어영문학과', '사학과', '철학과', '문헌정보학과'].map((department) => ({ college: '문과대학', department }));
  assert.throws(() => validateProfile({ ...base, programs: five }), /확인/);
  assert.throws(() => validateProfile({ ...base, programs: [{ college: '문과대학', department: '물리학과' }] }), /확인/);
  assert.throws(() => validateProfile({ ...base, year: 9 }), /확인/);
  assert.throws(() => validateProfile({ ...base, enrollmentStatus: '자유' }), /확인/);
});

test('stored programs are re-checked so a tampered row cannot inject unknown majors', () => {
  const stored = [{ college: '경영대학', department: '경영학과' }, { college: '경영대학', department: '경영학과' },
    { college: '가짜대학', department: 'x' }, { college: '경영대학', department: 7 }, null, 'text'];
  assert.deepEqual(parsePrograms(stored), [{ college: '경영대학', department: '경영학과' }]);
  assert.deepEqual(parsePrograms('nope'), []);
});

test('profile round trip uses the programs array and returns null when there is no row', async () => {
  const rows = [];
  const client = { from: () => ({ upsert: async (row) => { rows.push(row); return { error: null }; },
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: rows[0] ? { programs: rows[0].programs, year: 3, semester: null, enrollment_status: '재학', military_service: null, onboarded_at: null } : null, error: null }) }) }) }) };
  assert.equal(await loadProfile(client, 'u'), null);
  await saveProfile(client, 'u', { ...base, programs: [{ college: '경영대학', department: '경영학과' }], year: 3, enrollmentStatus: '재학' });
  assert.equal(rows[0].user_id, 'u');
  assert.deepEqual(rows[0].programs, [{ college: '경영대학', department: '경영학과' }]);
  assert.deepEqual((await loadProfile(client, 'u')).programs, [{ college: '경영대학', department: '경영학과' }]);
  await assert.rejects(saveProfile(client, 'u', { ...base, programs: [{ college: '경영대학', department: '물리학과' }] }), /확인/);
  assert.equal(rows.length, 1);
});

test('admission year and 3P selection round-trip and fall back to the old columns before the migration', async () => {
  const calls = [];
  const row = { programs: [], year: null, semester: null, enrollment_status: null, military_service: null, onboarded_at: null, interests: '', wants: '', avoids: '', admission_year: 2022, university_3p_internship_selected: false };
  const client = { from: () => ({
    select: (columns) => ({ eq: () => ({ maybeSingle: async () => { calls.push(columns); return columns.includes('admission_year') ? { data: row, error: null } : { data: { ...row, admission_year: undefined }, error: null }; } }) }),
    upsert: async (value) => { calls.push(Object.keys(value)); return { error: null }; },
  }) };
  const loaded = await loadProfile(client, 'u');
  assert.equal(loaded.admissionYear, 2022);
  assert.equal(loaded.university3pInternshipSelected, false);
  await saveProfile(client, 'u', { ...base, admissionYear: 2022, university3pInternshipSelected: true });
  assert.ok(calls.at(-1).includes('admission_year') && calls.at(-1).includes('university_3p_internship_selected'));

  const old = { from: () => ({
    select: (columns) => ({ eq: () => ({ maybeSingle: async () => columns.includes('admission_year')
      ? { data: null, error: { code: '42703', message: 'column user_profiles.admission_year does not exist' } }
      : { data: { ...row, admission_year: undefined, university_3p_internship_selected: undefined }, error: null } }) }),
    upsert: async (value) => ('admission_year' in value ? { error: { code: '42703', message: 'admission_year' } } : { error: null }),
  }) };
  assert.equal((await loadProfile(old, 'u')).admissionYear, null);
  await saveProfile(old, 'u', { ...base, admissionYear: 2022 });
  assert.throws(() => validateProfile({ ...base, admissionYear: 1999 }), /입학 연도/);
});

test('without only the new done columns, admission year and 3P selection are still read and saved', async () => {
  const attempts = [];
  const row = { programs: [], year: null, semester: null, enrollment_status: null, military_service: null, onboarded_at: null, interests: '', wants: '', avoids: '', admission_year: 2023, university_3p_internship_selected: true };
  const missing = { code: '42703', message: 'column user_profiles.dept_internship_done does not exist' };
  const client = { from: () => ({
    select: (columns) => ({ eq: () => ({ maybeSingle: async () => columns.includes('dept_internship_done') ? { data: null, error: missing } : { data: row, error: null } }) }),
    upsert: async (value) => { attempts.push(Object.keys(value)); return { error: 'dept_internship_done' in value ? missing : null }; },
  }) };
  const loaded = await loadProfile(client, 'u');
  assert.equal(loaded.admissionYear, 2023);
  assert.equal(loaded.deptInternshipDone, null);
  await saveProfile(client, 'u', { ...base, admissionYear: 2023, university3pInternshipSelected: true, deptInternshipDone: false, university3pInternshipDone: false });
  assert.equal(attempts.length, 3);   // 참여 사업 열 포함 → 끝낸 일 열 포함 → 입학 연도 열만
  assert.ok(attempts[2].includes('admission_year') && !attempts[2].includes('dept_internship_done'));
});

test('without only the joined_programs column, the done flags are still read and saved, and joined programs are cleaned', async () => {
  const attempts = [];
  const row = { programs: [], year: null, semester: null, enrollment_status: null, military_service: null, onboarded_at: null, interests: '', wants: '', avoids: '', admission_year: 2023, university_3p_internship_selected: true, dept_internship_done: true, university_3p_internship_done: false, joined_programs: ['futurecar', 'evil', 'ase', 'ase'] };
  const missing = { code: '42703', message: 'column user_profiles.joined_programs does not exist' };
  const client = { from: () => ({
    select: (columns) => ({ eq: () => ({ maybeSingle: async () => columns.includes('joined_programs') && !columns.includes('x') && client.old ? { data: null, error: missing } : { data: row, error: null } }) }),
    upsert: async (value) => { attempts.push(value); return { error: 'joined_programs' in value && client.old ? missing : null }; },
  }) };
  const loaded = await loadProfile(client, 'u');
  assert.deepEqual(loaded.joinedPrograms, ['futurecar', 'ase']);   // 모르는 id와 중복은 버린다
  client.old = true;
  const older = await loadProfile(client, 'u');
  assert.equal(older.deptInternshipDone, true);
  assert.deepEqual(older.joinedPrograms, ['futurecar', 'ase']);
  await saveProfile(client, 'u', { ...base, admissionYear: 2023, deptInternshipDone: true, university3pInternshipDone: false, joinedPrograms: ['futurecar', 'evil'] });
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0].joined_programs, ['futurecar']);
  assert.ok(!('joined_programs' in attempts[1]) && attempts[1].dept_internship_done === true);
});
