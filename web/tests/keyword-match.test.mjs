import assert from 'node:assert/strict';
import test from 'node:test';
import { keywordMatchesNotice, periodFitsSeason } from '../src/keyword-match.ts';

const winter = { start: '2026-12-22', end: '2027-02-27', days: 68 };   // 겨울방학 약 2개월
const summer = { start: '2027-06-28', end: '2027-08-27', days: 61 };
const long = { start: '2026-12-01', end: '2027-04-30', days: 151 };    // 5개월짜리

test('인턴: 낱말이 그대로 있으면 맞고, 인턴십도 인턴이 들어 있어 맞는다', () => {
  assert.equal(keywordMatchesNotice('인턴', '[회사] 인턴 채용'), true);
  assert.equal(keywordMatchesNotice('인턴', '[회사] 인턴십 모집'), true);
  assert.equal(keywordMatchesNotice('인턴', '장학금 안내'), false);
});

test('겨울방학 인턴: 같은 뜻의 말(동계, 겨울 방학)과 인턴이 따로 있어도 맞는다', () => {
  assert.equal(keywordMatchesNotice('겨울방학 인턴', '2026 동계 인턴 모집'), true);
  assert.equal(keywordMatchesNotice('겨울방학 인턴', '겨울 방학 현장실습 인턴'), true);
  assert.equal(keywordMatchesNotice('겨울방학 인턴', '여름방학 인턴 모집'), false);
  assert.equal(keywordMatchesNotice('여름방학 인턴', '2027 하계 인턴십'), true);
  assert.equal(keywordMatchesNotice('겨울방학 인턴', '장학금 안내 동계'), false);   // 인턴이 없으면 안 맞는다
});

test('방학 인턴은 그 방학 기간에 일하는 짧은 인턴십이다: 근무 기간이 맞으면 낱말이 없어도 맞고, 5개월짜리는 안 맞는다', () => {
  assert.equal(keywordMatchesNotice('겨울방학 인턴', '[회사] 인턴 채용', winter), true);
  assert.equal(keywordMatchesNotice('겨울방학 인턴', '[회사] 인턴 채용', long), false);
  assert.equal(keywordMatchesNotice('여름방학 인턴', '[회사] 인턴 채용', summer), true);
  assert.equal(keywordMatchesNotice('여름방학 인턴', '[회사] 인턴 채용', winter), false);
  assert.equal(periodFitsSeason({ start: null, end: null, days: 150 }, 'winter'), false);   // 날짜가 없으면 정하지 않는다
});

test('키워드 인턴은 기간과 상관없이 모든 인턴 공고에 맞는다(그래서 화면에서는 졸업요건 결과가 있을 때 숨긴다)', () => {
  assert.equal(keywordMatchesNotice('인턴', '[넷마블네오] AI 인턴십', long), true);
});
