import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BOARD_CATALOG, COLLEGE_BOARD, DEFAULT_BOARD, DEPARTMENT_BOARD, boardsForPrograms } from '../src/skku-boards.ts';
import { COLLEGES, validProgram } from '../src/skku-programs.ts';
import { EMPTY_PROFILE } from '../src/profile.ts';
import { KEYWORD_SUGGESTIONS, REQUIRED_ITEMS, missingItems, missingRequired, savedDoubleAnswer, canContinue, earlierMissing, filterDepartments, initialDraft, nextStep, previousStep, resumeStep, toggleValue, withPrograms } from '../src/onboarding-flow.ts';

const sw = { college: '소프트웨어융합대학', department: '소프트웨어학과' };
const biz = { college: '경영대학', department: '경영학과' };

test('recommended boards: school-wide first, then department and college boards of every major without repeats', () => {
  assert.deepEqual(boardsForPrograms([]), [DEFAULT_BOARD]);
  assert.deepEqual(boardsForPrograms([sw]), ['skku-notice01', 'cse-notice', 'sw-notice', 'aiuniv-notice']);
  assert.deepEqual(boardsForPrograms([sw, biz]), ['skku-notice01', 'cse-notice', 'sw-notice', 'aiuniv-notice', 'bus-notice', 'biz-notice']);
  assert.deepEqual(boardsForPrograms([sw, { college: '소프트웨어융합대학', department: '인공지능학과' }]),
    ['skku-notice01', 'cse-notice', 'sw-notice', 'aiuniv-notice', 'ai-notice']);
  // 학과 게시판이 없는 학과는 단과대학 게시판만, 둘 다 없는 곳은 성균관대 공지만 추천한다.
  assert.deepEqual(boardsForPrograms([{ college: '문과대학', department: '문헌정보학과' }]), ['skku-notice01', 'lis-notice', 'liberalarts-notice']);
  assert.deepEqual(boardsForPrograms([{ college: '의과대학', department: '의학과' }]), ['skku-notice01']);
  assert.deepEqual(boardsForPrograms([{ college: '학부대학', department: null }]), ['skku-notice01']);
});

test('소프트웨어융합대학 전공이면 AI중심대학사업단이 추천에 들어가고 다른 대학은 아니다', () => {
  assert.ok(boardsForPrograms([{ college: '소프트웨어융합대학', department: '소프트웨어학과' }]).includes('aiuniv-notice'));
  assert.ok(boardsForPrograms([{ college: '공과대학', department: '기계공학부' }, { college: '소프트웨어융합대학', department: null }]).includes('aiuniv-notice'));
  assert.ok(!boardsForPrograms([{ college: '공과대학', department: '기계공학부' }]).includes('aiuniv-notice'));
});

test('반도체 학과 전공이면 학과 단위로 추천된다', () => {
  const rec = boardsForPrograms([{ college: '정보통신대학', department: '반도체시스템공학과' }]);
  assert.ok(rec.includes('fabtech-notice') && rec.includes('ase-notice') && !rec.includes('aiuniv-notice'));
  for (const program of [{ college: '정보통신대학', department: '전자전기공학부' }, { college: '공과대학', department: '화학공학부' }, { college: '공과대학', department: '신소재공학부' }]) {
    assert.ok(boardsForPrograms([program]).includes('ase-notice'), program.department);
  }
  assert.ok(!boardsForPrograms([{ college: '공과대학', department: '기계공학부' }]).includes('ase-notice'));
});

test('앞 단계에 필수 답이 비면 뒤 단계에서 그 단계로 돌아가게 한다', () => {
  const ok = { programs: [{ college: '경영대학', department: '경영학과' }], year: 3, enrollmentStatus: '재학', militaryService: null, admissionYear: null,
    university3pInternshipSelected: false, deptInternshipDone: null, university3pInternshipDone: null, boards: [], keywords: [], boardsTouched: false };
  assert.equal(earlierMissing('boards', ok, 'no'), null);
  assert.equal(earlierMissing('boards', { ...ok, year: null }, 'no'), 'status');   // 학년이 비었다
  assert.equal(earlierMissing('notify', { ...ok, programs: [] }, 'no'), 'primary');   // 가장 앞의 빈 단계부터
  assert.equal(earlierMissing('internship', { ...ok, year: null }, 'no'), 'status');
  assert.equal(earlierMissing('status', { ...ok, year: null }, 'no'), null);   // 자기 단계는 다음 단추가 막는다
  assert.equal(earlierMissing('ai', { ...ok, university3pInternshipSelected: null }, 'no'), 'internship');
});

test('board catalog only points at known boards and valid college/department pairs', () => {
  const known = new Set([...BOARD_CATALOG.map((board) => board.id), 'skku-notice01', 'cse-notice', 'sw-notice', 'futurecar-notice']);
  assert.equal(new Set(BOARD_CATALOG.map((board) => board.id)).size, BOARD_CATALOG.length);
  assert.ok(BOARD_CATALOG.every((board) => /^[a-z0-9-]+$/.test(board.id) && board.url.startsWith('https://') && new URL(board.url).hostname.endsWith('.skku.edu')));
  for (const [college, id] of Object.entries(COLLEGE_BOARD)) {
    assert.ok(COLLEGES.some((item) => item.name === college), `unknown college ${college}`);
    assert.ok(known.has(id), `unknown board ${id}`);
  }
  for (const [key, id] of Object.entries(DEPARTMENT_BOARD)) {
    const [college, department] = key.split('/');
    assert.ok(validProgram({ college, department }), `invalid pair ${key}`);
    assert.ok(known.has(id), `unknown board ${id}`);
  }
});

test('the web catalog and the worker config list the same boards, all collected on demand', () => {
  const yaml = readFileSync(new URL('../../config/sources.yaml', import.meta.url), 'utf8');
  const block = yaml.slice(yaml.indexOf('# BEGIN catalog'), yaml.indexOf('# END catalog'));
  const ids = [...block.matchAll(/- id: (\S+)/g)].map((match) => match[1]);
  const urls = [...block.matchAll(/url: (\S+)/g)].map((match) => match[1]);
  assert.deepEqual(ids, BOARD_CATALOG.map((board) => board.id));
  assert.deepEqual(urls, BOARD_CATALOG.map((board) => board.url));
  assert.equal([...block.matchAll(/on_demand: true/g)].length, BOARD_CATALOG.length);
});

test('initial draft pre-selects the usual status and keeps what the user already chose', () => {
  const fresh = initialDraft({ ...EMPTY_PROFILE, programs: [sw] }, [], ['장학']);
  assert.equal(fresh.enrollmentStatus, '재학');
  assert.equal(fresh.year, null);
  assert.deepEqual(fresh.boards, boardsForPrograms([sw]));
  assert.equal(fresh.boardsTouched, false);
  const returning = initialDraft({ ...EMPTY_PROFILE, programs: [sw], year: 3, enrollmentStatus: '휴학' }, ['cse-notice'], []);
  assert.deepEqual([returning.year, returning.enrollmentStatus, returning.boards, returning.boardsTouched], [3, '휴학', ['cse-notice'], true]);
});

test('changing majors updates recommendations unless the boards were chosen by hand; no duplicate or more than four majors', () => {
  const draft = initialDraft(EMPTY_PROFILE, [], []);
  const next = withPrograms(draft, [sw, biz, sw]);
  assert.deepEqual(next.programs, [sw, biz]);
  assert.deepEqual(next.boards, boardsForPrograms([sw, biz]));
  // 직접 고른 게시판은 두되, 새로 고른 전공의 단과대·학과 게시판은 켠다(이미 받는 게시판이 있는 계정도 같다).
  const hand = withPrograms({ ...next, boards: ['skku-notice01'], boardsTouched: true }, [biz]);
  assert.deepEqual(hand.boards, ['skku-notice01']);   // 경영학과는 이미 추천돼 있던 전공이라 사용자가 끈 것을 다시 켜지 않는다
  const subscribed = initialDraft(EMPTY_PROFILE, ['skku-notice01'], []);
  assert.equal(subscribed.boardsTouched, true);
  assert.deepEqual(withPrograms(subscribed, [sw]).boards, ['skku-notice01', 'cse-notice', 'sw-notice', 'aiuniv-notice']);
  const five = ['국어국문학과', '영어영문학과', '사학과', '철학과', '문헌정보학과'].map((department) => ({ college: '문과대학', department }));
  assert.equal(withPrograms(draft, five).programs.length, 4);
});

test('steps move forward and back in order and required answers gate the next button', () => {
  assert.equal(previousStep('primary'), null);
  assert.equal(nextStep('primary'), 'double');
  assert.equal(nextStep('status'), 'internship');
  assert.equal(nextStep('internship'), 'boards');
  assert.equal(nextStep('boards'), 'notify');
  assert.equal(nextStep('notify'), 'ai');
  assert.equal(nextStep('ai'), null);
  const draft = initialDraft(EMPTY_PROFILE, [], []);
  assert.equal(canContinue('primary', draft), false);
  assert.equal(canContinue('double', draft), false, 'the double major question needs an answer before 다음');
  assert.equal(canContinue('double', draft, 'no'), true, 'no double major is a valid answer');
  assert.equal(canContinue('double', draft, 'yes'), false, 'yes without a chosen department cannot continue');
  assert.equal(canContinue('double', withPrograms(draft, [sw, biz]), 'yes'), true);
  assert.equal(canContinue('primary', withPrograms(draft, [sw])), true);
  assert.equal(canContinue('status', withPrograms(draft, [sw])), false, 'year is required');
  assert.equal(canContinue('status', { ...draft, year: 2 }), true);
});

test('department search ignores spaces and case, and keyword toggling is symmetric', () => {
  assert.deepEqual(filterDepartments(['국어국문학과', '철학과'], ' 철 학 '), ['철학과']);
  assert.deepEqual(filterDepartments(['국어국문학과', '철학과'], ''), ['국어국문학과', '철학과']);
  assert.deepEqual(filterDepartments(['AI융합운영전공'], 'ai'), ['AI융합운영전공']);
  assert.deepEqual(toggleValue(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleValue(['a', 'b'], 'a'), ['b']);
  assert.ok(KEYWORD_SUGGESTIONS.length <= 12 && new Set(KEYWORD_SUGGESTIONS).size === KEYWORD_SUGGESTIONS.length);
});

test('저장까지 하고 AI 키 단계에서 나간 사람은 다시 열면 AI 키 단계부터 잇는다', () => {
  // 처음 온 사람: 저장한 것이 없으니 첫 단계부터
  assert.equal(resumeStep(EMPTY_PROFILE, initialDraft(EMPTY_PROFILE, [], [])), 'primary');
  // 경영학과 3학년 재학, 3품 인턴십까지 저장했다(게시판 단계의 저장). 복수전공이 없다는 답은 저장된 전공 하나로 안다.
  const saved = { ...EMPTY_PROFILE, programs: [biz], year: 3, enrollmentStatus: '재학', university3pInternshipSelected: true, university3pInternshipDone: false };
  assert.equal(resumeStep(saved, initialDraft(saved, ['skku-notice01'], [])), 'ai');
  // 소프트웨어학과 원전공인데 입학 연도가 비어 있으면(새로 생긴 필수 질문) 처음부터 묻는다
  const missing = { ...saved, programs: [sw] };
  assert.equal(resumeStep(missing, initialDraft(missing, [], [])), 'primary');
});

const completeProfile = { ...EMPTY_PROFILE, programs: [biz], year: 3, enrollmentStatus: '재학', university3pInternshipSelected: true, university3pInternshipDone: false, onboardedAt: 'x' };
const missingFor = (profile, usable, registry) => { const draft = initialDraft(profile, [], []); return missingRequired(draft, savedDoubleAnswer(draft), { usable }, registry); };

test('missingRequired: complete account is empty, no key is [ai], unknown key is never missing', () => {
  assert.deepEqual(missingFor(completeProfile, true), []);
  assert.deepEqual(missingFor(completeProfile, false), ['ai']);
  assert.deepEqual(missingFor(completeProfile, null), []);
});

test('missingRequired: software major without admission year, and empty profile, come back in step order', () => {
  const swProfile = { ...completeProfile, programs: [sw], admissionYear: null, deptInternshipDone: true };
  assert.deepEqual(missingFor(swProfile, true), ['internship']);
  assert.deepEqual(missingFor(swProfile, false), ['internship', 'ai']);
  assert.deepEqual(missingFor({ ...EMPTY_PROFILE, onboardedAt: 'x' }, true), ['primary', 'status', 'internship']);
});

test('missingRequired: a new required item added to the registry is the only missing step for an otherwise complete account', () => {
  const fake = { step: 'phone', label: '연락처', missing: () => true };
  const registry = [...REQUIRED_ITEMS, fake];
  assert.deepEqual(missingFor(completeProfile, true, registry), ['phone']);
  // 목록이 순서와 이름의 유일한 출처다.
  const draft = initialDraft(completeProfile, [], []);
  assert.deepEqual(missingItems({ draft, doubleAnswer: 'no', keysUsable: true }, registry).map((item) => item.label), ['연락처']);
  assert.deepEqual(REQUIRED_ITEMS.map((item) => item.step), ['primary', 'double', 'status', 'internship', 'ai']);
});
