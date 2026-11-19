import test from 'node:test';
import assert from 'node:assert/strict';
import { isNoticeId, noticeLink, noticeIdFromSearch, withoutNotice, loadPublicNotice, publicRowToNotice } from '../src/deeplink.ts';

test('notice id format matches the database function', () => {
  for (const id of ['skku-notice01/12345', 'linkareer/987', 'a/1']) assert.equal(isNoticeId(id), true, id);
  for (const id of ['', 'x', 'a/', '/1', 'A/1', 'a/1/2', 'a/b', 'a b/1', '../x/1', 'a/1\n', null, undefined, 5, 'a/' + '1'.repeat(300)]) assert.equal(isNoticeId(id), false, String(id));
});

test('link builds an absolute app url with the slash encoded and drops other query and hash', () => {
  const link = noticeLink('skku-notice01/123', 'https://app.example/skku/?api=sample&tab=intern#x');
  assert.equal(link, 'https://app.example/skku/?notice=skku-notice01%2F123');
  assert.equal(noticeIdFromSearch(new URL(link).search), 'skku-notice01/123');
});

test('search parsing accepts encoded and plain slashes and rejects bad ids', () => {
  assert.equal(noticeIdFromSearch('?notice=a%2F1'), 'a/1');
  assert.equal(noticeIdFromSearch('?notice=a/1&tab=all'), 'a/1');
  for (const search of ['', '?notice=', '?notice=bad', '?notice=a%2F1%2F2', '?notice=<script>', '?tab=all']) assert.equal(noticeIdFromSearch(search), null, search);
});

test('returning from login keeps notice and only the sign-in leftovers are removable', () => {
  assert.equal(withoutNotice('https://a.example/?notice=a%2F1&view=settings'), 'https://a.example/?view=settings');
});

const row = { id: 'linkareer/55', source_id: 'linkareer', source_name: '링커리어', external: true, title: '인턴', category: null,
  url: 'https://linkareer.com/activity/55', posted_on: '2026-11-18', deadline: '2026-11-30T14:59:00+00:00', body: '본문', body_html: '<p>본문</p>' };

test('public row becomes a notice with an empty personal part', () => {
  const result = publicRowToNotice(row);
  assert.equal(result.notice.article_no, '55');
  assert.equal(result.notice.source_id, 'linkareer');
  assert.equal(result.external, true);
  assert.equal(result.source, '링커리어');
  assert.equal(result.body.summary, null);
  assert.equal(result.body.body_html, '<p>본문</p>');
});

test('loader calls only get_public_notice, returns null when empty and throws on transport errors', async () => {
  const calls = [];
  const client = (result) => ({ rpc: async (...args) => { calls.push(args); return result; }, from: () => { throw new Error('tables must not be read'); } });
  assert.equal((await loadPublicNotice(client({ data: [row], error: null }), 'linkareer/55')).notice.id, 'linkareer/55');
  assert.deepEqual(calls[0], ['get_public_notice', { p_id: 'linkareer/55' }]);
  assert.equal(await loadPublicNotice(client({ data: [], error: null }), 'linkareer/56'), null);
  assert.equal(await loadPublicNotice(client({ data: [row], error: null }), 'bad id'), null);
  assert.equal(calls.length, 2);   // 형식이 틀린 id는 호출하지 않는다
  await assert.rejects(loadPublicNotice(client({ data: null, error: new Error('net') }), 'a/1'));
});
