import assert from 'node:assert/strict';
import test from 'node:test';
import { bodyInterests, withMyDeadline } from '../src/notice-view.ts';

// 화면에서 쓰는 글자 매칭과 같은 규칙(공백을 없애고 글자가 그대로 있을 때만)을 단순하게 흉내 낸다.
const matches = (word, text) => text.replace(/\s+/g, '').includes(word.replace(/\s+/g, ''));
const notice = (extra = {}) => ({ id: 'a/1', title: '공지', deadline: null, ...extra });
const mine = (extra = {}) => ({ summary: 's', deadline: '2026-11-10T05:00:00Z', deadlineKind: '마감', ai: null, ...extra });

test('a deadline read from the body fills in only when the notice has none', () => {
  assert.equal(withMyDeadline(notice(), mine()).deadline, '2026-11-10T05:00:00Z');
  assert.equal(withMyDeadline(notice(), mine()).deadline_kind, '마감');
  const own = notice({ deadline: '2026-11-20T00:00:00Z', deadline_kind: '일정' });
  assert.equal(withMyDeadline(own, mine()), own, 'the shared deadline is never replaced');
  const plain = notice();
  assert.equal(withMyDeadline(plain, null), plain);
  assert.equal(withMyDeadline(plain, mine({ deadline: null })), plain);
  assert.equal(plain.deadline, null, 'the shared notice object itself is not changed');
});

test('keywords are found in the body and in text read from pictures, only when the letters are really there', () => {
  const body = { body: '장학금 신청 안내', ocr_text: ['인턴 모집 포스터'] };
  assert.deepEqual(bodyInterests(['장학', '인턴', '공모전'], body, matches), ['장학', '인턴']);
  assert.deepEqual(bodyInterests(['장학'], 'loading', matches), []);
  assert.deepEqual(bodyInterests(['장학'], null, matches), []);
  assert.deepEqual(bodyInterests(['장학'], { body: null }, matches), []);
});
