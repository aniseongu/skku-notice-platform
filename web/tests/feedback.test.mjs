import test from 'node:test';
import assert from 'node:assert/strict';
import { feedbackProblem, sendFeedback } from '../src/feedback.ts';

test('보내기 전 검사: 내용, 길이, 메일 모양', () => {
  assert.equal(feedbackProblem('', ''), '내용을 적어 주세요');
  assert.equal(feedbackProblem('   ', ''), '내용을 적어 주세요');
  assert.match(feedbackProblem('가'.repeat(501), '') ?? '', /500자/);
  assert.equal(feedbackProblem('좋아요', ''), null);
  assert.equal(feedbackProblem('좋아요', 'me@example.com'), null);
  assert.match(feedbackProblem('좋아요', 'not-an-email') ?? '', /메일 주소/);
});

test('보내기는 다듬은 값을 넣고, 하루 한도와 그 밖의 실패를 구분한다', async () => {
  const calls = [];
  const client = (error) => ({ from: (table) => ({ insert: async (row) => { calls.push([table, row]); return { error }; } }) });
  assert.equal(await sendFeedback(client(null), 'bug', ' 안 열려요 ', ' '), 'ok');
  assert.deepEqual(calls[0], ['user_feedback', { kind: 'bug', body: '안 열려요', reply_email: null }]);
  assert.equal(await sendFeedback(client({ message: 'feedback_limit' }), 'idea', 'x', 'a@b.co'), 'limit');
  assert.equal(await sendFeedback(client({ message: 'boom' }), 'idea', 'x', ''), 'error');
  assert.equal(await sendFeedback(null, 'idea', 'x', ''), 'error');
  assert.equal(await sendFeedback(client(null), 'idea', '', ''), 'error');
  assert.equal(calls.length, 3);
});
