import assert from 'node:assert/strict';
import test from 'node:test';
import { AFTER_COMPLETION, inquiryText, isInternshipNotice, isSoftwareOriginal, loadGraduation, parseAssessment, requestGraduation, STATUS_TEXT } from '../src/graduation-assessment.ts';

const track = (status, extra = {}) => ({ status, label: '라벨', checks: [{ rule_id: 'DEPT-WORK', result: 'pass', note: '업무 확인' }], unknowns: ['법인 여부'], after_completion: ['DEPT-EVALUATION'], notes: [], ...extra });

test('a pending row has no result and a ready row parses both tracks independently', () => {
  assert.equal(parseAssessment(null), null);
  assert.equal(parseAssessment({ status: 'PENDING', department: null }).state, 'pending');
  const ready = parseAssessment({ status: 'READY', ai_status: 'used', department: track('LIKELY'), university_3p: track('NOT_ELIGIBLE'), facts: { organization_name: '(주)예시', work_mode: 'full_time', start_date: '2026-12-21', end_date: '2027-02-28', explicitly_stated_hours: null, task_category: 'software_qa', missing_fields: ['법인 여부'] } });
  assert.equal(ready.state, 'ready');
  assert.equal(ready.department.status, 'LIKELY');
  assert.equal(ready.university3p.status, 'NOT_ELIGIBLE');
  assert.equal(ready.facts.organizationName, '(주)예시');
});

test('a tampered row cannot inject unknown statuses, markup-like control characters or too many items', () => {
  const parsed = parseAssessment({ status: 'READY', department: track('APPROVED'), university_3p: track('CONDITIONAL', { notes: ['a\u0000b', ...Array(40).fill('x')], unknowns: 'bad' }) });
  assert.equal(parsed.department, null);
  assert.equal(parsed.university3p.notes.length, 12);
  assert.ok(!parsed.university3p.notes[0].includes('\u0000'));
  assert.deepEqual(parsed.university3p.unknowns, []);
});

test('no status text claims an approval and every after-completion rule has plain text', () => {
  assert.ok(Object.values(STATUS_TEXT).every((label) => !/인정 완료|합격|승인됨/.test(label)));
  for (const id of ['DEPT-EVALUATION', 'DEPT-WORK-COMMITTEE', 'DEPT-COMPANY-DOCS', 'DEPT-LAB-DOCS', 'DEPT-DEADLINE', 'DEPT-OTHER-APPROVAL', '3P-EVIDENCE', '3P-APPLICATION']) assert.ok(AFTER_COMPLETION[id]);
});

test('only a software-department original major sees the check, and only on internship notices', () => {
  const sw = { college: '소프트웨어융합대학', department: '소프트웨어학과' };
  const biz = { college: '경영대학', department: '경영학과' };
  assert.equal(isSoftwareOriginal({ programs: [sw] }), true);
  assert.equal(isSoftwareOriginal({ programs: [biz, sw] }), false);
  assert.equal(isSoftwareOriginal({ programs: [] }), false);
  assert.equal(isInternshipNotice({ title: '수강 안내' }, false), false);
  assert.equal(isInternshipNotice({ title: '에이비씨 2026 겨울 현장실습 모집' }, false), true);
  assert.equal(isInternshipNotice({ title: '채용' }, true), true);
  assert.equal(isInternshipNotice({ title: '공지', source_id: 'skku-career-intern' }, false), true);
});

test('the inquiry text carries posting facts but no personal data', () => {
  const text = inquiryText('개발 인턴', { organizationName: '(주)예시', workMode: 'full_time', startDate: '2026-12-21', endDate: '2027-02-28', hours: null, taskCategory: 'software_qa', missing: [] });
  assert.match(text, /제28조/);
  assert.match(text, /\(주\)예시/);
  assert.match(text, /전일제/);
  assert.ok(!/학번|이메일|입학/.test(text));
});

test('requesting inserts only the request columns and loading reads only the own row', async () => {
  let written; const filters = [];
  const client = { from: () => ({
    insert: async (value) => { written = value; return { error: null }; },
    select: () => ({ eq(key, val) { filters.push([key, val]); return this; }, maybeSingle: async () => ({ data: null, error: null }) }),
  }) };
  await requestGraduation(client, 'u1', 'n1');
  assert.deepEqual(Object.keys(written).sort(), ['notice_id', 'requested_at', 'status', 'user_id']);
  assert.equal(written.status, 'PENDING');
  assert.equal(await loadGraduation(client, 'u1', 'n1'), null);
  assert.deepEqual(filters, [['user_id', 'u1'], ['notice_id', 'n1']]);
});

test('requesting again updates only status and requested_at (never upsert, which the column grants reject)', async () => {
  let updated; const eqs = [];
  const client = { from: () => ({
    insert: async () => ({ error: { code: '23505' } }),
    update: (value) => { updated = value; return { eq(key, val) { eqs.push([key, val]); return eqs.length === 2 ? Promise.resolve({ error: null }) : this; } }; },
  }) };
  await requestGraduation(client, 'u1', 'n1');
  assert.deepEqual(Object.keys(updated).sort(), ['requested_at', 'status']);
  assert.deepEqual(eqs, [['user_id', 'u1'], ['notice_id', 'n1']]);
  const failing = { from: () => ({ insert: async () => ({ error: { code: '42501' } }) }) };
  await assert.rejects(() => requestGraduation(failing, 'u1', 'n1'));
});

import { visibleTracks, threePAnswer, threePFields, shortReason, reasonOf } from '../src/graduation-assessment.ts';
const SW_PROGRAMS = [{ college: '소프트웨어융합대학', department: '소프트웨어학과' }];
const flags = (over = {}) => ({ programs: SW_PROGRAMS, deptInternshipDone: null, university3pInternshipDone: null, university3pInternshipSelected: null, ...over });

test('채우지 않은 요건만 공지에 보여 준다', () => {
  assert.deepEqual(visibleTracks(flags()), { dept: true, p3: true });
  assert.deepEqual(visibleTracks(flags({ university3pInternshipDone: true })), { dept: true, p3: false });
  assert.deepEqual(visibleTracks(flags({ deptInternshipDone: true })), { dept: false, p3: true });
  assert.deepEqual(visibleTracks(flags({ deptInternshipDone: true, university3pInternshipDone: true })), { dept: false, p3: false });
  assert.deepEqual(visibleTracks(flags({ university3pInternshipSelected: false })), { dept: true, p3: false });
});

test('소프트웨어학과 원전공이 아니면 학과 판정은 보이지 않는다', () => {
  assert.deepEqual(visibleTracks(flags({ programs: [{ college: '경영대학', department: '경영학과' }] })), { dept: false, p3: true });
  assert.deepEqual(visibleTracks(flags({ programs: [{ college: '경영대학', department: '경영학과' }, ...SW_PROGRAMS] })), { dept: false, p3: true });
});

test('신3품 인턴십 답은 채움·선택 여부로 오간다', () => {
  for (const answer of ['done', 'todo', 'no']) assert.equal(threePAnswer(threePFields(answer)), answer);
  assert.equal(threePAnswer({ university3pInternshipDone: null, university3pInternshipSelected: null }), null);
  assert.equal(threePFields('done').university3pInternshipSelected, true);
  assert.equal(threePFields('no').university3pInternshipDone, false);
});

test('이유는 이름 표기와 규정 설명을 떼고 첫 문장만 남긴다', () => {
  assert.equal(shortReason('학과 졸업 인턴십: 공고에서 확인되지 않은 조건이 있어요'), '공고에서 확인되지 않은 조건이 있어요');
  assert.equal(shortReason('기관 종류를 확인하지 못했어요. 기타 기관은 수행 전에 졸업평가위원회 심의가 필요해요'), '기관 종류를 확인하지 못했어요');
  assert.equal(shortReason('근무 시간을 공고에서 확인하지 못했어요'), '근무 시간을 공고에서 확인하지 못했어요');
  const track = { status: 'NEEDS_REVIEW', label: '확인 필요', checks: [{ ruleId: 'a', result: 'unknown', note: '기관 종류를 확인하지 못했어요. 기타 기관은 심의가 필요해요' }], unknowns: [], afterCompletion: [], notes: [] };
  assert.equal(reasonOf(track), '기관 종류를 확인하지 못했어요');
});

import { isInternshipNotice as isIntern2, badgeOf as badgeOf2 } from '../src/graduation-assessment.ts';
test('행정 안내는 인턴 공고가 아니고 회사 이름이 있는 학교 글만 대상이다', () => {
  assert.equal(isIntern2({ title: '[인턴십] 서류 제출 안내 - 2027년 2월(동계) 졸업 예정자 중 미제출자 대상' }, false), false);
  assert.equal(isIntern2({ title: '3품 인턴십 인증 신청 절차 안내' }, false), false);
  assert.equal(isIntern2({ title: '넷마블네오 AI 인턴 모집' }, false), true);
  assert.equal(isIntern2({ title: '인턴 모집' , source_id: 'skku-career-intern' }, false), true);
  assert.equal(isIntern2({ title: '인턴 서류 제출 안내', source_id: 'skku-career-intern' }, false), false);
  assert.equal(isIntern2({ title: '장학금 안내' }, true), true);
});
test('표지는 보이는 영역의 판정만 합친다', () => {
  const all = { dept: true, p3: true };
  assert.equal(badgeOf2({ dept: 'NOT_ELIGIBLE', p3: 'LIKELY' }, all), 'ok');
  assert.equal(badgeOf2({ dept: 'NOT_ELIGIBLE', p3: 'LIKELY' }, { dept: true, p3: false }), 'no');
  assert.equal(badgeOf2({ dept: 'NEEDS_REVIEW', p3: 'NOT_ELIGIBLE' }, all), 'review');
  assert.equal(badgeOf2(undefined, all), 'review');
});
