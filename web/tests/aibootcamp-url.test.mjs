import assert from 'node:assert/strict';
import test from 'node:test';
import { allowAiBootcampBodyUrl } from '../src/aibootcamp-url.ts';

test('bootcamp body URLs allow only the board article and image routes', () => {
  const origin = 'https://aibootcamp-skku.co.kr';
  const image = '/data/file/news/thumb-post_600x750.png';
  assert.ok(allowAiBootcampBodyUrl(origin + '/news/45', false));
  assert.ok(allowAiBootcampBodyUrl(origin + image, true));
  assert.ok(allowAiBootcampBodyUrl(origin + '/data/editor/2611/post.jpg', true));
  assert.ok(allowAiBootcampBodyUrl('https://forms.gle/example', false));
  for (const spoof of [origin + '.evil.com', origin + '@evil.com', origin.replace('://', '://user@'),
    origin + ':443', origin + ':8443', origin.replace('https:', 'http:')]) {
    assert.equal(allowAiBootcampBodyUrl(spoof + '/news/45', false), false);
    assert.equal(allowAiBootcampBodyUrl(spoof + image, true), false);
  }
  assert.equal(allowAiBootcampBodyUrl(origin + '/bbs/download.php', false), false);
  assert.equal(allowAiBootcampBodyUrl(origin + '/news/45', true), false);
  assert.equal(allowAiBootcampBodyUrl(origin + '/data/file/news/picture.svg', true), false);
});
