import assert from 'node:assert/strict';
import test from 'node:test';
import { isExpired, noticeKind } from '../src/notice-scope.ts';
import { loadPublicFeed } from '../src/platform-data.ts';

const school = { id: 'skku-notice01', name: '성대 공지', url: 'https://a.test' };
const intern = { id: 'linkareer', name: '링커리어', url: 'https://b.test', external: true };
const coop = { id: 'skku-coop', name: '현장실습', url: 'https://c.test', external: true, coop: true };

test('notices are sorted into 성대 공지, 인턴 공고 and 현장실습 by their source', () => {
  assert.equal(noticeKind(school), 'all');
  assert.equal(noticeKind(intern), 'intern');
  assert.equal(noticeKind(coop), 'coop');   // external이어도 인턴 공고가 아니다
  assert.equal(noticeKind(undefined), 'all');
});

test('expired notices are hidden: expires_at passed, or a 현장실습 deadline passed', () => {
  const now = Date.parse('2026-11-13T00:00:00Z');
  const base = { deadline: null };
  assert.equal(isExpired({ ...base, expires_at: '2026-11-12T00:00:00Z' }, coop, now), true);
  assert.equal(isExpired({ ...base, expires_at: '2026-11-14T00:00:00Z' }, coop, now), false);
  assert.equal(isExpired({ deadline: '2026-11-12T00:00:00Z' }, coop, now), true);
  // 인턴 공고와 학교 공지는 마감이 지나도 저장 목록에 남을 수 있으므로 마감만으로 숨기지 않는다.
  assert.equal(isExpired({ deadline: '2026-11-12T00:00:00Z' }, intern, now), false);
  assert.equal(isExpired({ deadline: '2026-11-12T00:00:00Z' }, school, now), false);
  assert.equal(isExpired({ deadline: null }, coop, now), false);
  assert.equal(isExpired({ deadline: null, expires_at: null }, school, now), false);
});

// 열 이름 목록을 받아 그 열이 없으면 오류를 돌려주는 가짜 클라이언트
function fakeClient({ missing = [] } = {}) {
  const calls = [];
  const table = (name, rows) => {
    const q = { cols: '' };
    const api = {
      select: (cols) => { q.cols = cols; return api; },
      order: () => api,
      limit: () => api,
      then: (resolve) => {
        calls.push([name, q.cols]);
        const bad = missing.find((col) => q.cols.split(',').includes(col));
        resolve(bad ? { data: null, error: { message: `column ${bad} does not exist` } } : { data: rows, error: null });
      },
    };
    return api;
  };
  const sources = [{ id: 'skku-coop', name: '현장실습', url: 'https://c.test', last_success_at: '2026-11-10T00:00:00Z', external: true, coop: true }];
  const notices = [{ id: 'skku-coop/1', source_id: 'skku-coop', expires_at: '2026-12-01T00:00:00Z' }];
  return { calls, from: (name) => (name === 'platform_notices' ? table(name, notices) : table(name, sources)) };
}

test('the feed carries coop and expires_at when the columns exist', async () => {
  const feed = await loadPublicFeed(fakeClient());
  assert.equal(feed.sources[0].coop, true);
  assert.equal(feed.notices[0].expires_at, '2026-12-01T00:00:00Z');
});

test('the feed still loads when the coop and expires_at columns are missing', async () => {
  const client = fakeClient({ missing: ['coop', 'expires_at'] });
  const feed = await loadPublicFeed(client);
  assert.ok(feed, 'the feed must not break');
  assert.equal(feed.sources.length, 1);
  assert.equal(feed.sources[0].external, true);
  const last = client.calls.filter(([n]) => n === 'platform_notices').at(-1)[1];
  assert.ok(!last.includes('expires_at'));
});

test('the feed still loads when external is missing too (oldest schema)', async () => {
  const feed = await loadPublicFeed(fakeClient({ missing: ['coop', 'external', 'expires_at'] }));
  assert.ok(feed);
  assert.equal(feed.sources.length, 1);
});
