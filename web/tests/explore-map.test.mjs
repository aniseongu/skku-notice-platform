import assert from 'node:assert/strict';
import test from 'node:test';
import { DISPLAY_ORDER, domainOf, statusLine, summarize } from '../src/explore-map.ts';

const d = (title, board = null, category = null) => domainOf({ title, board, category });

test('domainOf sends each kind of notice to its area', () => {
  assert.equal(d('2027-1 교환학생 파견 안내'), 'exchange');
  assert.equal(d('국가장학금 2차 신청'), 'scholarship');
  assert.equal(d('AI 해커톤 참가자 모집'), 'contest');
  assert.equal(d('하계 인턴 채용'), 'career');
  assert.equal(d('2026 졸업 요건 안내'), 'academic');
  assert.equal(d('진로 멘토링 프로그램'), 'extra');
  assert.equal(d('도서관 이용 안내'), 'other');
});
test('board name and category count, and the first matching area wins (specific before general)', () => {
  assert.equal(d('2027학년도 안내', '교환학생 공지'), 'exchange');
  assert.equal(d('안내', null, '채용'), 'career');
  assert.equal(d('교환학생 장학금 안내'), 'exchange');
  assert.equal(d('인턴 장학생 모집'), 'scholarship');
  assert.equal(d('AI 경진대회 INTERN 공고'.replace('INTERN', 'intern')), 'contest');
});
test('summarize counts per area and status, counts a notice once and keeps "그 밖" separate from the six areas', () => {
  const s = summarize([
    { id: '1', title: '인턴 채용', board: null, status: 'interested' },
    { id: '1', title: '인턴 채용', board: null, status: 'applied' },
    { id: '2', title: '신입 채용', board: null, status: 'applied' },
    { id: '3', title: '장학금', board: null, status: 'preparing' },
    { id: '4', title: '도서관', board: null, status: 'result' },
  ]);
  assert.equal(s.total, 4);
  assert.deepEqual(s.domains.map((x) => x.id), [...DISPLAY_ORDER]);
  assert.equal(s.domains.length, 6);
  const career = s.domains.find((x) => x.id === 'career');
  assert.equal(career.count, 2);
  assert.deepEqual(career.byStatus, { interested: 1, preparing: 0, applied: 1, result: 0 });
  assert.equal(s.domains.find((x) => x.id === 'scholarship').count, 1);
  assert.equal(s.domains.find((x) => x.id === 'exchange').count, 0);
  assert.equal(s.other.count, 1);
});
test('zero items gives total 0 and all areas empty; statusLine hides zero statuses', () => {
  const s = summarize([]);
  assert.equal(s.total, 0);
  assert.ok(s.domains.every((x) => x.count === 0 && x.hint.length > 0));
  assert.equal(statusLine({ interested: 2, preparing: 0, applied: 1, result: 0 }), '관심 2 · 지원 1');
  assert.equal(statusLine({ interested: 0, preparing: 0, applied: 0, result: 0 }), '');
});
