import { test, expect } from '@playwright/test';

test('React notice list opens the detail and settings', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?api=sample/api/v1');
  const rows = page.locator('notice-rows-screen a.row');
  await expect(rows.first()).toBeVisible();
  await rows.nth(1).click();
  const detail = testInfo.project.name === 'mobile' ? '.reading notice-detail-screen' : '.detail-pane notice-detail-screen';
  await expect(page.locator(`${detail} .detail-title`)).toBeVisible();
  await page.goto('/?view=settings&api=sample/api/v1');
  await expect(page.locator('platform-settings-screen').getByRole('heading', { name: '계정' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('notice HTML is sanitized in React detail', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.waitForFunction(() => !!customElements.get('notice-detail-screen'));
  await page.evaluate(() => {
    const el = document.createElement('notice-detail-screen') as HTMLElement & { model: unknown };
    el.id = 'xss-check';
    document.body.append(el);
    el.model = { notice: { id: 'a/1', source_id: 'a', article_no: '1', title: 'test', category: null, url: 'https://example.com', posted_on: '2026-11-01', pinned: false, deadline: null, first_seen: null }, source: 'test', today: '2026-11-07', body: { version: 1, id: 'a/1', summary: null, body: null, body_html: '<p>안전</p><img src=x onerror="window.__xss=1"><a href="javascript:alert(1)">bad</a>', attachments: [], ocr_text: ['<script>악성 내용</script>'], fetched_at: '2026-11-01' }, interests: [], ai: null, rule: null, notified: false, retry() {} };
  });
  await expect(page.locator('#xss-check .rich')).toBeVisible();
  await expect(page.locator('#xss-check [onerror], #xss-check a[href^="javascript:"], #xss-check script')).toHaveCount(0);
  await expect(page.locator('#xss-check [aria-label="그림에서 읽은 글"]')).toContainText('<script>악성 내용</script>');
});

test('keyword editor saves input and clears a previous account on account change', async ({ page }) => {
  await page.goto('/?view=settings&api=sample/api/v1');
  const screen = page.locator('platform-settings-screen');
  await expect(screen.getByRole('heading', { name: '계정' })).toBeVisible();
  await page.evaluate(() => {
    const el = document.querySelector('platform-settings-screen') as HTMLElement & { model: unknown };
    (window as unknown as { keywordResult: string }).keywordResult = '';
    el.model = { configured: true, userId: 'account-a', email: null, authBusy: false, authError: '', sources: [], subscriptions: [], subscriptionsOnly: false, setSubscriptionsOnly() {}, loading: false, error: '', keywords: ['장학'], preferencesLoading: false, preferencesError: '', preferencesUnavailable: false, retryPreferences() {}, saveKeywords(value: string) { (window as unknown as { keywordResult: string }).keywordResult = value; }, signIn() {}, signOut() {}, toggle() {}, retry() {} };
  });
  const input = screen.getByRole('textbox', { name: '관심 키워드' });
  await expect(input).toHaveValue('장학');
  await input.fill('장학\n인턴');
  await screen.getByRole('button', { name: '키워드 저장하기' }).click();
  expect(await page.evaluate(() => (window as unknown as { keywordResult: string }).keywordResult)).toBe('장학\n인턴');
  await page.evaluate(() => {
    const el = document.querySelector('platform-settings-screen') as HTMLElement & { model: unknown };
    el.model = { configured: true, userId: 'account-b', email: null, authBusy: false, authError: '', sources: [], subscriptions: [], subscriptionsOnly: false, setSubscriptionsOnly() {}, loading: false, error: '', keywords: [], preferencesLoading: false, preferencesError: '', preferencesUnavailable: false, retryPreferences() {}, saveKeywords() {}, signIn() {}, signOut() {}, toggle() {}, retry() {} };
  });
  await expect(input).toHaveValue('');
});

test('subscription filter keeps only the selected school board', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  const rows = page.locator('notice-rows-screen a.row');
  await expect(rows.first()).toBeVisible();
  const ids = await rows.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-id') ?? ''));
  const source = ids[0].split('/')[0];
  expect(ids.some((id) => !id.startsWith(`${source}/`))).toBeTruthy();
  await page.evaluate((id) => {
    const app = document.querySelector('notice-app') as HTMLElement & Record<string, unknown>;
    app.authUserId = 'account-a';
    app.subscriptions = [id];
    app.subscriptionsError = '';
    app.subscriptionsLoading = false;
    app.subscriptionsOnly = true;
  }, source);
  await expect.poll(async () => rows.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-id') ?? '')))
    .toEqual(ids.filter((id) => id.startsWith(`${source}/`)));
});
