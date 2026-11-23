import { test, expect } from '@playwright/test';
import { deepLink, fastEntryFixture, sharedBody, sharedId, sharedTitle, summaryOf, switchAccount } from './fixtures/fast-entry.mjs';

function hold() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { gate, release };
}

test('an unlisted, unsubscribed notice uses the full detail, can be saved, and keeps progress in Saved', async ({ page }, testInfo) => {
  const fixture = await fastEntryFixture(page, { storedSummary: false, judgmentOnly: true, hasKey: true });
  await page.goto(deepLink());
  await expect(page.getByRole('heading', { name: sharedTitle })).toBeVisible();
  await expect(page.getByText(sharedBody)).toBeVisible();
  await expect(page.getByText('이번에 만든 요약이에요.')).toBeVisible();
  await expect(page.getByText('판정 이유예요.')).toBeVisible();
  await page.getByRole('button', { name: '저장하기' }).click();
  await page.getByRole('radio', { name: '준비 중' }).click();
  await expect(page.getByRole('radio', { name: '준비 중' })).toBeChecked();

  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '목록으로' }).click();
  await expect(page.locator('notice-rows-screen').getByText(sharedTitle)).toHaveCount(0);
  await expect(page.locator('notice-rows-screen').getByText('목록의 미구독 게시판 공지')).toHaveCount(0);
  await page.getByRole('navigation', { name: '보기' }).getByRole('button', { name: /^저장(?:\s|$)/ }).click();
  const saved = page.locator('notice-rows-screen .row').filter({ hasText: sharedTitle });
  await expect(saved).toContainText('준비 중');

  expect(fixture.requests.filter((request) => request.args?.action === 'summarize')).toHaveLength(1);
  expect(fixture.requests.some((request) => request.endpoint === 'set_notice_saved' && request.args.p_notice_id === sharedId)).toBe(true);
  expect(fixture.requests.filter((request) => request.endpoint === 'platform_notices' && request.id === sharedId)
    .some((request) => request.columns.split(',').includes('body'))).toBe(false);
});

test('saved detail is painted before refresh and a live account switch clears the cache and ignores late replies', async ({ page }) => {
  const accountA = hold();
  const accountB = hold();
  const fixture = await fastEntryFixture(page);
  await page.goto(deepLink());
  await expect(page.getByText(summaryOf('A'))).toBeVisible();
  await expect.poll(() => page.evaluate(async (id) => {
    const { loadDetailCache } = await import('/src/detail-cache.ts');
    return (await loadDetailCache('A', id)).info?.summary;
  }, sharedId)).toBe(summaryOf('A'));

  fixture.settings.infoGate = (owner) => owner === 'A' ? accountA.gate : accountB.gate;
  try {
    await page.goto(deepLink());
    await expect(page.getByText(summaryOf('A'))).toBeVisible();
    await expect.poll(() => fixture.requests.filter((request) => request.id === sharedId && request.owner === 'A'
      && ['user_notice_summaries', 'user_notice_judgments'].includes(request.endpoint)).length).toBe(4);

    await page.evaluate((url) => history.replaceState(history.state, '', url), deepLink());
    await switchAccount(page, 'B');
    await expect(page.getByText(summaryOf('A'))).toHaveCount(0);
    await expect(page.getByRole('heading', { name: sharedTitle })).toBeVisible();
    accountA.release();
    await expect.poll(() => page.evaluate(async (id) => {
      const { loadDetailCache } = await import('/src/detail-cache.ts');
      return Object.keys(await loadDetailCache('A', id)).length;
    }, sharedId)).toBe(0);
    await expect(page.getByText(summaryOf('A'))).toHaveCount(0);
    accountB.release();
    await expect(page.getByText(summaryOf('B'))).toBeVisible();
    await expect(page.getByText(summaryOf('A'))).toHaveCount(0);

    await switchAccount(page, null);
    await expect.poll(() => page.evaluate(async (id) => {
      const { loadDetailCache } = await import('/src/detail-cache.ts');
      return Object.keys(await loadDetailCache('B', id)).length;
    }, sharedId)).toBe(0);
  } finally {
    accountA.release();
    accountB.release();
  }
});

test('a failed summary read cannot trigger generation even with an active AI key', async ({ page }) => {
  const fixture = await fastEntryFixture(page, { hasKey: true, summaryError: true });
  const failed = page.waitForResponse((response) => response.url().includes('user_notice_summaries') && response.status() === 503);
  await page.goto(deepLink());
  await failed;
  await expect(page.getByText(sharedBody)).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as { hasUsableAiKey(): boolean };
    return app.hasUsableAiKey();
  })).toBe(true);
  await expect(page.getByText('이번에 만든 요약이에요.')).toHaveCount(0);
  expect(fixture.requests.filter((request) => request.args?.action === 'summarize')).toHaveLength(0);
});

test('deep-link prefetch during first setup reads personal info without requesting generation', async ({ page }) => {
  const fixture = await fastEntryFixture(page, { onboarded: false, hasKey: true, storedSummary: false });
  const id = 'external-intern/777';
  await page.goto(deepLink(id));
  await expect.poll(() => fixture.requests.filter((request) => request.id === id && request.method === 'GET'
    && ['user_notice_summaries', 'user_notice_judgments'].includes(request.endpoint)).length).toBe(2);
  await expect(page.locator('.onb').first()).toBeVisible();
  expect(fixture.requests.some((request) => request.args?.action === 'summarize')).toBe(false);
  expect(fixture.requests.some((request) => request.endpoint === 'user_notice_graduation_assessments' && request.method !== 'GET')).toBe(false);
});

test('an English deep link reads the translated body while translated titles are pending', async ({ page }) => {
  const titles = hold();
  const fixture = await fastEntryFixture(page, { english: true, translationTitlesGate: titles.gate });
  try {
    await page.goto(deepLink());
    await expect(page.getByText('저장된 번역 본문이에요.')).toBeVisible();
    expect(fixture.requests.some((request) => request.endpoint === 'user_notice_translations' && request.id === sharedId)).toBe(true);
  } finally { titles.release(); }
});

for (const [id, kind, title] of [['external-intern/777', 'intern', '외부 인턴 공고'], ['skku-coop/777', 'coop', '현장실습 공고']]) {
  test(`a shared ${kind} notice opens with its original notice kind`, async ({ page }) => {
    await fastEntryFixture(page);
    await page.goto(deepLink(id));
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText(sharedBody)).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const app = document.querySelector('notice-app') as unknown as { deepNotice: { notice: unknown }; kindOf(notice: unknown): string };
      return app.kindOf(app.deepNotice.notice);
    })).toBe(kind);
  });
}

test('Saved can recover an out-of-feed notice in a fresh browser context', async ({ page }) => {
  const saved = new Map([[sharedId, { notice_id: sharedId, is_saved: true, read_at: null }]]);
  await fastEntryFixture(page, { saved });
  await page.goto('/?tab=saved');
  await expect(page.locator('notice-rows-screen .row').filter({ hasText: sharedTitle })).toBeVisible();
});

test('a late list snapshot fills pending fields without replacing the live feed or subscriptions', async ({ page }) => {
  const snapshot = hold();
  const deadlines = hold();
  const fixture = await fastEntryFixture(page, { deadlinesGate: deadlines.gate });
  await page.exposeFunction('waitForListSnapshot', () => snapshot.gate);
  await page.route(/\/src\/list-cache\.ts$/, (route) => route.fulfill({ contentType: 'text/javascript', body: `
    export * from '/src/list-cache.ts?fixture';
    import { loadListCache as read } from '/src/list-cache.ts?fixture';
    export const loadListCache = async (userId) => { await window.waitForListSnapshot(); return read(userId); };
  ` }));
  await page.goto('/favicon.svg');
  await page.evaluate(async () => {
    const { saveListCache } = await import('/src/list-cache.ts?fixture');
    const sources = [{ id: 'skku-notice01', name: '예전 게시판', url: 'https://www.skku.edu/' }];
    const notices = [{ id: 'skku-notice01/100', source_id: 'skku-notice01', article_no: '100', title: '예전 공지 제목',
      url: 'https://www.skku.edu/', posted_on: '2026-11-23', first_seen: null, pinned: false, category: null, deadline: null }];
    await saveListCache('A', { generatedAt: '2026-11-23T00:00:00Z', sources, notices,
      subscriptions: ['unsubscribed'], keywords: [], boardOrder: [], deadlines: new Map([['skku-notice01/100', { deadline: '2099-02-01', deadlineKind: '마감' }]]),
      judgments: new Map(), interests: new Map(), translations: new Map(), graduation: new Map() });
  });
  try {
    await page.goto('/');
    const row = page.locator('notice-rows-screen .row').filter({ hasText: '목록 첫 번째 공지' });
    await expect(row).toBeVisible();
    await expect(row).not.toContainText(/D-/);
    snapshot.release();
    await expect(row).toContainText(/D-/);
    await expect(page.locator('notice-rows-screen .row').filter({ hasText: '예전 공지 제목' })).toHaveCount(0);
    await expect(page.locator('notice-rows-screen .row').filter({ hasText: '목록의 미구독 게시판 공지' })).toHaveCount(0);
    expect(fixture.requests.filter((request) => request.columns === 'notice_id,deadline,deadline_kind')).toHaveLength(2);
    deadlines.release();
    await expect(row).not.toContainText(/D-/);
  } finally { snapshot.release(); deadlines.release(); }
});

test('saved graduation results and progress stay visible while their refresh is pending', async ({ page }) => {
  const fixture = await fastEntryFixture(page, { graduation: true });
  const id = 'external-intern/777';
  fixture.opportunities.set(id, { notice_id: id, title: '외부 인턴 공고', status: 'applied', note: '지원서를 보냈어요.' });
  const progress = page.getByRole('radio', { name: '지원함' });
  const reason = page.getByText(/인턴십 요건 근거예요/);
  await page.goto(deepLink(id));
  await expect(progress).toBeChecked();
  await expect(reason).toBeVisible();
  await expect.poll(() => page.evaluate(async (noticeId) => {
    const { loadDetailCache } = await import('/src/detail-cache.ts');
    const data = await loadDetailCache('A', noticeId);
    return [data.graduation?.state, data.opportunity?.status];
  }, id)).toEqual(['ready', 'applied']);

  const refresh = hold();
  fixture.settings.graduationGate = refresh.gate;
  fixture.settings.opportunityGate = refresh.gate;
  try {
    await page.goto(deepLink(id));
    await expect(progress).toBeChecked();
    await expect(reason).toBeVisible();
  } finally { refresh.release(); }
});
