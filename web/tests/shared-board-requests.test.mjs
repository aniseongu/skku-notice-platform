import assert from 'node:assert/strict';
import test from 'node:test';
import { listBoardRequests, submitBoardRequest } from '../src/shared-board-requests.ts';

test('a changed session cannot submit a board request for the old account', async () => {
  let called = false;
  const client = { auth: { getSession: async () => ({ data: { session: { user: { id: 'b' } } }, error: null }) },
    rpc: async () => { called = true; return { error: null }; } };
  assert.deepEqual(await submitBoardRequest(client, 'a', '공지', 'https://www.skku.edu/a.do'), { status: 'error' });
  assert.equal(called, false);
});

test('submission binds the expected account for the database check', async () => {
  let sent;
  const client = { auth: { getSession: async () => ({ data: { session: { user: { id: 'a' } } }, error: null }) },
    rpc: async (name, args) => { sent = { name, args }; return { data: 'r1', error: null }; } };
  assert.deepEqual(await submitBoardRequest(client, 'a', '공지', 'https://www.skku.edu/a.do'), { status: 'ok', id: 'r1' });
  assert.deepEqual(sent, { name: 'submit_shared_board', args: { expected_user: 'a', request_name: '공지', request_url: 'https://www.skku.edu/a.do' } });
});

test('a delayed response from a previous session is discarded', async () => {
  let current = 'a';
  const query = { select: () => query, eq: () => query, order: () => query,
    limit: async () => { current = 'b'; return { data: [{ id: 'r', name: '공지', status: 'added' }], error: null }; } };
  const client = { auth: { getSession: async () => ({ data: { session: { user: { id: current } } }, error: null }) },
    from: () => query };
  assert.equal(await listBoardRequests(client, 'a'), null);
});
