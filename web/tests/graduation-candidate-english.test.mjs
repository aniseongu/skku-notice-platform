import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('English intern titles are graduation candidates, but international/internal and admin notices are not', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    // 첫 migration은 다른 표를 쓰는 함수도 만들어 판정 함수만 있는 새 파일만 실행한다.
    await db.exec(await readFile(new URL('../../supabase/migrations/20261113100000_graduation_candidate_english.sql', import.meta.url), 'utf8'));
    const ok = async (title, source = 'school', external = false) =>
      (await db.query('select public.is_graduation_candidate_notice($1,$2,$3) as v', [title, source, external])).rows[0].v;
    for (const title of ['Global Internship Program 2026', 'Summer INTERN recruitment', 'Co-op program', 'Internships open', '2026 겨울 인턴 모집', '현장실습 참가자 모집']) {
      assert.equal(await ok(title), true, title);
    }
    for (const title of ['International student notice', 'Internal audit notice', 'Intern results announcement', 'Internship orientation',
      'Internship information session', 'Internship certificate', '인턴 결과 발표', '장학금 안내']) {
      assert.equal(await ok(title), false, title);
    }
    assert.equal(await ok('anything', 'x', true), true);
    assert.equal(await ok('Notice', 'skku-career-intern'), true);
  } finally {
    await db.close();
  }
});
