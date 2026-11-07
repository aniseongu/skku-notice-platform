import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPublicBody } from '../src/platform-data.ts';

function clientFor(ocr) {
  const body = { data: { id: 'school/1', body: '본문', body_html: null, attachments: [], images: ['https://www.skku.edu/a.png'], fetched_at: '2026-11-07T00:00:00Z' }, error: null };
  return { from(table) {
    const query = {
      select() { return query; }, eq() { return query; }, limit() { return Promise.resolve(ocr); },
      maybeSingle() { return Promise.resolve(body); },
    };
    if (!['platform_notices', 'platform_notice_images'].includes(table)) throw new Error('unexpected table');
    return query;
  } };
}

test('detail includes only current image OCR and keeps body when OCR is unavailable', async () => {
  const result = await loadPublicBody(clientFor({ data: [
    { image_url: 'https://www.skku.edu/a.png', platform_ocr_cache: { extracted_text: '인식한 글' } },
    { image_url: 'https://www.skku.edu/old.png', platform_ocr_cache: { extracted_text: '오래된 글' } },
  ], error: null }), 'school', '1');
  assert.deepEqual(result.ocr_text, ['인식한 글']);
  assert.equal(result.body, '본문');
  const fallback = await loadPublicBody(clientFor({ data: null, error: new Error('offline') }), 'school', '1');
  assert.deepEqual(fallback.ocr_text, []);
  assert.equal(fallback.body, '본문');
});
