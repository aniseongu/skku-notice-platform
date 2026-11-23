import { expect, test, type Page } from '@playwright/test';
import { deepLink, fastEntryFixture, plainNotice, school, shared, sharedBody, sharedId, sharedTitle, switchAccount } from './fixtures/fast-entry.mjs';

const externalId = 'external-intern/777';
const coopId = 'skku-coop/777';
const schoolIntern = 'skku-career-intern/777';
const loginPanel = (page: Page) => page.getByRole('region', { name: '로그인 안내' });
const slot = (page: Page) => page.getByRole('button', { name: '이 게시판도 받기' });
const row = (page: Page, id: string) => page.locator(`notice-rows-screen a[data-id="${id}"]`);
const tab = (page: Page) => page.locator(page.viewportSize()!.width < 720 ? '.tabbar [aria-current=page]' : '.sidebar nav [aria-current=page]');
const wide = (page: Page) => page.viewportSize()!.width >= 720;
const closeDetail = (page: Page) => page.getByRole('button', { name: wide(page) ? '상세 칸 닫기' : '목록으로', exact: true }).click();
const mobileUA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 KAKAOTALK/11.0.0';
const filteredBoard = 'platform:user:A:board';
const noticeHook = (page: Page) => page.getByRole('button', { name: '로그인하면 이 공지의 세 줄 요약을 볼 수 있어요' });

test.beforeEach(async ({ page }, info) => {
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 412, height: 892 } : { width: 1440, height: 900 });
});

test('guest sharing shows only public data and connects locked actions to the right signup surface', async ({ page }) => {
  const fixture = await fastEntryFixture(page, { user: null, attachments: [{ name: '장학 안내.pdf', url: 'https://www.skku.edu/file' }], publicDeadline: '2099-02-01T00:00:00Z' });
  await page.goto(deepLink());
  await expect(page.getByRole('heading', { name: sharedTitle })).toBeVisible();
  await expect(loginPanel(page)).toBeVisible();
  await expect(page.getByText(sharedBody)).toBeVisible();
  await expect(page.locator('notice-detail-screen .meta time')).toHaveText(/월.*일/);
  await expect(page.getByRole('link', { name: /장학 안내.pdf/ })).toHaveAttribute('href', 'https://www.skku.edu/file');
  await expect(page.getByRole('link', { name: '원문 보기' })).toBeVisible();
  await expect(page.getByRole('button', { name: '로그인하고 내 진행 상태 기록하기' })).toBeVisible();
  await expect(page.getByRole('button', { name: '로그인하고 질문·후기 보기' })).toBeVisible();
  await expect(page.locator('.notice-preview .summary, .share-subscription, notice-rows-screen')).toHaveCount(0);
  if (wide(page)) {
    await expect(page.locator('.notice-preview > .sidebar')).toBeVisible();
    await expect(page.locator('.notice-preview > .list-pane')).toBeVisible();
    await expect(page.locator('.notice-preview > .detail-pane')).toBeVisible();
    await expect(page.locator('.login-sheet')).toHaveCount(0);
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(loginPanel(page)).toContainText('로그인하면 저장한 공지를 모아 볼 수 있어요');
    await expect(page.getByRole('heading', { name: sharedTitle })).toBeVisible();
  } else {
    const dismiss = () => page.getByRole('button', { name: '다음에 할게요' }).click();
    const bar = page.locator('.login-bar').getByRole('button', { name: '로그인', exact: true });
    await dismiss();
    await expect(bar).toBeFocused();
    await page.reload();
    await expect(bar).toBeVisible();
    await expect(loginPanel(page)).toHaveCount(0);
    await noticeHook(page).click();
    await expect(page.getByRole('button', { name: 'Google로 계속하기' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(bar).toBeFocused();
    await page.getByRole('button', { name: '저장하기' }).click();
    await expect(loginPanel(page)).toBeVisible();
    await dismiss();
    await bar.click();
    await expect(loginPanel(page)).toBeVisible();
  }
  await noticeHook(page).click();
  await expect(page.getByRole('button', { name: 'Google로 계속하기' })).toBeFocused();
  expect(fixture.requests.length).toBe(wide(page) ? 1 : 2);
  expect(fixture.requests.every((request) => request.endpoint === 'get_public_notice' && request.args.p_id === sharedId)).toBe(true);
  await page.getByRole('button', { name: wide(page) ? '상세 칸 닫기' : '뒤로 가기' }).click();
  await expect(page.locator('.notice-preview')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Google로 계속하기' })).toBeVisible();
});

test.describe('KakaoTalk embedded browser', () => {
  test.use({ userAgent: mobileUA });
  test('opens the same shared link using the external browser action', async ({ page }) => {
    const fixture = await fastEntryFixture(page, { user: null });
    await page.goto(deepLink(externalId));
    await expect(page.getByRole('button', { name: '로그인하고 인턴십 요건 확인하기' })).toBeVisible();
    const external = loginPanel(page).getByRole('link', { name: '브라우저에서 열기' });
    await expect(external).toHaveAttribute('href', `kakaotalk://web/openExternal?url=${encodeURIComponent(page.url())}`);
    await external.click();
    await expect(loginPanel(page).getByRole('button', { name: 'Google로 계속하기' })).toHaveCount(0);
    expect(fixture.requests.map((request) => request.endpoint)).toEqual(['get_public_notice']);
  });
});

test.describe('other embedded browsers', () => {
  test.use({ userAgent: mobileUA.replace('KAKAOTALK/11.0.0', 'Instagram 300.0') });
  test('shows the menu path in place of Google OAuth', async ({ page }) => {
    await fastEntryFixture(page, { user: null });
    await page.goto(deepLink());
    await loginPanel(page).getByRole('button', { name: '브라우저에서 열기' }).click();
    await expect(loginPanel(page)).toContainText('앱 메뉴에서 ‘다른 브라우저로 열기’를 눌러 주세요.');
  });
});

test('an unsubscribed school notice joins the regular list with one subscription click', async ({ page }) => {
  const fixture = await fastEntryFixture(page);
  await page.goto(deepLink() + '&tab=intern');
  await expect(page.getByRole('heading', { name: sharedTitle })).toBeVisible();
  await expect(tab(page)).toContainText('성대 공지');
  await expect(slot(page)).toBeEnabled();
  await expect(page.locator('.share-subscription')).toHaveText('구독하지 않은 게시판이에요이 게시판도 받기');
  await expect(row(page, sharedId)).toHaveCount(0);
  await expect(row(page, `${shared}/101`)).toHaveCount(0);
  await slot(page).click();
  await expect(slot(page)).toHaveCount(0);
  await expect(row(page, sharedId)).toHaveAttribute('aria-current', 'true');
  expect([...fixture.subscriptions.get('A')]).toContain(shared);
  expect(fixture.requests.filter((request) => request.endpoint === 'user_source_subscriptions' && request.method === 'POST')).toHaveLength(1);
  await closeDetail(page);
  await expect(tab(page)).toContainText('성대 공지');
  await expect(row(page, sharedId)).toBeVisible();
  await expect(row(page, sharedId)).toHaveAttribute('aria-current', 'false');
});

test('subscribing identifies the current row even when AI judgment is still pending', async ({ page }) => {
  const fresh = { ...plainNotice(sharedId, shared, sharedTitle), first_seen: new Date().toISOString() };
  await fastEntryFixture(page, { hasKey: true, additionalNotices: [fresh] });
  await page.goto(deepLink());
  await slot(page).click();
  await expect(row(page, sharedId)).toHaveAttribute('aria-current', 'true');
  await closeDetail(page);
  await expect(tab(page)).toContainText('성대 공지');
  await expect(row(page, sharedId)).toHaveCount(0);
});

test('a subscribed notice has its current row and no subscription prompt', async ({ page }) => {
  await fastEntryFixture(page);
  const id = `${school}/100`;
  await page.goto(deepLink(id) + '&tab=saved');
  await expect(row(page, id)).toHaveAttribute('aria-current', 'true');
  await expect(slot(page)).toHaveCount(0);
  await closeDetail(page);
  await expect(tab(page)).toContainText('성대 공지');
  await expect(row(page, id)).toBeVisible();
});

test('a school internship uses the school-board subscription path and shows a retryable error', async ({ page }) => {
  const fixture = await fastEntryFixture(page, { subscriptionError: true });
  await page.goto(deepLink(schoolIntern) + '&tab=intern');
  await expect(page.getByRole('heading', { name: '학생인재개발팀 인턴 게시판 공고' })).toBeVisible();
  await expect(tab(page)).toContainText('성대 공지');
  await slot(page).click();
  await expect(page.locator('.toast')).toContainText('구독을 저장하지 못했어요');
  await expect(slot(page)).toBeEnabled();
  expect(fixture.subscriptions.get('A').has('skku-career-intern')).toBe(false);
  await closeDetail(page);
  await expect(tab(page)).toContainText('성대 공지');
});

test('a pending subscription stays scoped to the original account after switching', async ({ page }) => {
  let resolve!: () => void;
  const gate = new Promise<void>((done) => { resolve = done; });
  const fixture = await fastEntryFixture(page, { subscriptionGate: gate });
  try {
    await page.goto(deepLink());
    await slot(page).click();
    await expect.poll(() => fixture.requests.some((request) => request.endpoint === 'user_source_subscriptions' && request.method === 'POST')).toBe(true);
    await page.evaluate((url) => history.replaceState(history.state, '', url), deepLink());
    await switchAccount(page, 'B');
    await expect.poll(() => fixture.subscriptions.has('B')).toBe(true);
    await expect(slot(page)).toBeEnabled();
    resolve();
    await expect.poll(() => fixture.subscriptions.get('A').has(shared)).toBe(true);
    await expect(slot(page)).toBeEnabled();
    expect(fixture.subscriptions.get('B').has(shared)).toBe(false);
    await expect(row(page, sharedId)).toHaveCount(0);
  } finally { resolve(); }
});

for (const filtered of [false, true]) {
  test(`external notice uses the internship tab and ${filtered ? 'preserves a site filter' : 'highlights a dimmed current row'}`, async ({ page }) => {
    const board = filtered ? 'jasoseol' : 'linkareer';
    const id = `${board}/777`;
    const title = filtered ? '자소설닷컴 공고' : '링커리어 공고';
    const other = plainNotice('linkareer/11', 'linkareer', '다른 사이트 공고');
    const external = plainNotice(id, board, title);
    await fastEntryFixture(page, { additionalNotices: [external, other], unrelatedId: id });
    if (filtered) await page.addInitScript(({ key }) => localStorage.setItem(key, 'linkareer'), { key: filteredBoard });
    await page.goto(deepLink(id) + '&tab=saved');
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.locator('notice-detail-screen').getByText('내 조건에 맞지 않아요.')).toBeVisible();
    await expect(tab(page)).toContainText('인턴 공고');
    await expect(slot(page)).toHaveCount(0);
    if (filtered) {
      await expect(row(page, id)).toHaveCount(0);
      await expect(row(page, other.id)).toBeAttached();
    } else {
      await expect(row(page, id)).toHaveAttribute('aria-current', 'true');
      await expect(row(page, id)).toHaveClass(/\bdim\b/);
    }
    await closeDetail(page);
    await expect(tab(page)).toContainText('인턴 공고');
    if (filtered) {
      await expect(row(page, id)).toHaveCount(0);
      await expect(row(page, other.id)).toBeVisible();
    }
  });
}

for (const inFeed of [false, true]) {
  test(`coop opens when its tab is ${inFeed ? 'present after a late feed' : 'hidden'} and closes into the matching list`, async ({ page }) => {
    const coop = plainNotice(coopId, 'skku-coop', '현장실습 공고');
    let release = () => {};
    const feedGate = inFeed ? new Promise<void>((resolve) => { release = resolve; }) : undefined;
    await fastEntryFixture(page, { additionalNotices: inFeed ? [coop] : [], feedGate });
    try {
      await page.goto(deepLink(coopId) + '&tab=intern');
      await expect(page.getByRole('heading', { name: '현장실습 공고' })).toBeVisible();
      await expect(page.getByRole('link', { name: '톨게이트에서 신청하기' })).toBeVisible();
      await expect(slot(page)).toHaveCount(0);
      await expect(tab(page)).toContainText('인턴 공고');
      release();
      const expected = inFeed ? '현장실습' : '인턴 공고';
      await expect(tab(page)).toContainText(expected);
      if (inFeed) await expect(row(page, coopId)).toHaveAttribute('aria-current', 'true');
      await closeDetail(page);
      await expect(tab(page)).toContainText(expected);
      await expect(page.getByRole('heading', { name: '현장실습 공고' })).toHaveCount(0);
    } finally { release(); }
  });
}

for (const guest of [false, true]) {
  test(`a missing notice gives a one-click exit ${guest ? 'to login' : 'to the same list'}`, async ({ page }) => {
    await fastEntryFixture(page, { user: guest ? null : 'A', missingIds: [sharedId] });
    await page.goto(deepLink());
    const empty = page.getByRole('region', { name: '공유 공지' });
    await expect(empty.getByRole('heading', { name: '공지를 찾을 수 없어요' })).toBeVisible();
    await expect(empty).toContainText('공지가 삭제됐거나 마감됐을 수 있어요');
    if (guest) await expect(loginPanel(page)).toBeVisible();
    await empty.getByRole('button', { name: guest ? '로그인하고 다른 공지 보기' : '목록으로 돌아가기' }).click();
    await expect(empty).toHaveCount(0);
    if (guest) await expect(page.getByRole('button', { name: 'Google로 계속하기' })).toBeVisible();
    else {
      await expect(tab(page)).toContainText('성대 공지');
      await expect(row(page, `${school}/100`)).toBeVisible();
    }
  });
}

test('at exactly 720px authenticated sharing keeps the right detail pane and navigation', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.setViewportSize({ width: 720, height: 900 });
  await fastEntryFixture(page);
  await page.goto(deepLink());
  await expect(page.locator('.detail-pane').getByRole('heading', { name: sharedTitle })).toBeVisible();
  await expect(tab(page)).toContainText('성대 공지');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(720);
  await closeDetail(page);
  await expect(row(page, `${school}/100`)).toBeVisible();
});
