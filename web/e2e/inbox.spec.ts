import { test, expect, type Page } from '@playwright/test';

type App = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// 서버 없이 알림함을 본다: 이 기기의 IndexedDB(idb-keyval 기본 DB)에 항목을 직접 넣고 계정만 주입한다.
const NOW = Date.now();
const item = (id: string, owner: string, minutes: number, extra: Record<string, unknown> = {}) =>
  ({ id, owner, tag: `t-${id}`, title: `알림 ${id}`, body: `본문 ${id}`, noticeId: null, url: 'https://cse.skku.edu/a', at: NOW - minutes * 60000, read: false, ...extra });

async function seed(page: Page, items: unknown[], owner: string | null) {
  await page.evaluate(async ({ items, owner }) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const request = indexedDB.open('keyval-store');
      request.onupgradeneeded = () => request.result.createObjectStore('keyval');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('keyval', 'readwrite');
      tx.objectStore('keyval').put({ version: 1, owner: owner ? { userId: owner, endpoint: null } : null, items }, 'inbox:v1');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, { items, owner });
}
async function setup(page: Page, items: unknown[], opts: { pushOn?: boolean; withNotice?: boolean; direct?: boolean } = {}) {
  await page.goto(`/?api=sample/api/v1${opts.direct ? '&view=settings&section=inbox' : ''}`);
  await (opts.direct ? page.getByRole('heading', { name: '알림함', level: 1 }) : page.locator('notice-rows-screen a.row').first()).waitFor();
  await page.waitForLoadState('networkidle');
  const noticeId = await page.evaluate(() => (document.querySelector('notice-app') as unknown as App).notices[0].id as string);
  const list = items.map((entry) => (opts.withNotice && (entry as { id: string }).id === '1' ? { ...(entry as object), noticeId, tag: `notice:${noticeId}` } : entry));
  await seed(page, list, 'account-a');
  await page.evaluate(async (pushOn) => {
    const app = document.querySelector('notice-app') as unknown as App;
    app.profileStatus = 'unavailable'; app.authUserId = 'account-a'; app.onboardingDismissed = true;
    app.subscriptions = app.sources.map((s: { id: string }) => s.id); app.subscriptionsLoading = false;
    app.pushStatus = pushOn === false ? 'off' : 'on';
    await app.refreshInbox();
  }, opts.pushOn);
  return noticeId;
}
const bell = (page: Page) => page.getByRole('button', { name: /^알림함/ });

test('the bell shows an unread dot, opens the inbox in one tap and lists only this account, newest first', async ({ page }, info) => {
  await setup(page, [item('1', 'account-a', 60), item('2', 'account-a', 5), item('3', 'account-b', 1), item('4', 'account-a', 3000, { read: true })]);
  await expect(bell(page)).toHaveAccessibleName('알림함, 안 읽은 알림 2개');
  const box = await bell(page).boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(36);
  const url = page.url();
  await bell(page).click();                                              // 열기: 1탭
  const dialog = page.getByRole('dialog', { name: '알림함', exact: true });
  await expect(dialog.getByRole('heading', { name: '알림함', level: 2 })).toBeVisible();
  const rows = page.locator('.inbox-row');
  await expect(rows).toHaveCount(3);                                     // 다른 계정의 알림은 보이지 않는다
  await expect(rows.nth(0)).toContainText('알림 2');
  await expect(rows.nth(1)).toContainText('알림 1');
  await expect(rows.nth(2)).toContainText('알림 4');
  await expect(rows.nth(0)).toContainText('5분 전');
  await expect(page.getByText('이 기기에서 받은 알림을 30일 동안 보관해요')).toBeVisible();
  const open = await rows.nth(0).locator('.inbox-open').boundingBox();
  expect(open!.height).toBeGreaterThanOrEqual(44);
  expect(page.url()).toBe(url);
  const panel = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  if (info.project.name === 'desktop') {
    expect(panel.width).toBeCloseTo(400);
    expect(panel.x + panel.width).toBeCloseTo(box!.x + box!.width);
    expect(panel.y).toBeGreaterThan(box!.y + box!.height);
    expect(panel.height).toBeLessThanOrEqual(viewport.height * 0.7);
  } else {
    expect(panel.width).toBeCloseTo(viewport.width);
    await expect.poll(async () => {
      const sheet = (await dialog.boundingBox())!;
      return Math.round(sheet.y + sheet.height);
    }).toBe(viewport.height);
    expect(panel.height).toBeLessThanOrEqual(viewport.height * 0.75);
  }
});

test('tapping a notice alert opens that notice in the app and marks the alert read (the notice read state is separate)', async ({ page }) => {
  const id = await setup(page, [item('1', 'account-a', 5), item('2', 'account-a', 9)], { withNotice: true });
  await bell(page).click();
  await page.locator('.inbox-row').nth(0).locator('.inbox-open').click();   // 공지 열기: 1탭 (종 1탭 + 항목 1탭 = 2탭)
  await expect(page.getByRole('dialog', { name: '알림함', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => { const app = document.querySelector('notice-app') as unknown as App; return app.openedId || app.selectedId; })).toBe(id);
  expect(page.url()).not.toContain('section=inbox');
  expect(await page.evaluate(() => (document.querySelector('notice-app') as unknown as App).view)).not.toBe('settings');
  await expect.poll(() => page.evaluate(() => (document.querySelector('notice-app') as unknown as App).inboxUnread)).toBe(1);   // 눌린 알림만 읽음
});

test('read-all, single delete and clear-all (with one confirmation) work and persist', async ({ page }) => {
  await setup(page, [item('1', 'account-a', 5), item('2', 'account-a', 9), item('3', 'account-a', 20)]);
  await bell(page).click();
  const rows = page.locator('.inbox-row');
  await page.getByRole('button', { name: '모두 읽음으로 표시' }).click();
  await expect(rows.locator('.inbox-title.font-semibold')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '모두 읽음으로 표시' })).toBeDisabled();
  const remove = page.getByRole('button', { name: '알림 지우기: 알림 2' });
  const box = (await remove.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await remove.click();
  await expect(rows).toHaveCount(2);
  const stored = await page.evaluate(async () => new Promise<number>((resolve) => {
    const request = indexedDB.open('keyval-store');
    request.onsuccess = () => { const get = request.result.transaction('keyval').objectStore('keyval').get('inbox:v1'); get.onsuccess = () => resolve(get.result.items.length); };
  }));
  expect(stored).toBe(2);                                                  // 지운 것은 저장소에서도 지워졌다
});

test('clear-all asks once before deleting', async ({ page }) => {
  await setup(page, [item('1', 'account-a', 5), item('2', 'account-a', 9)]);
  await bell(page).click();
  const clear = page.getByRole('button', { name: '모두 지우기', exact: true });
  await expect(clear).toHaveClass(/\btext-ink-2\b/);
  await clear.click();
  await expect(page.locator('.inbox-row')).toHaveCount(2);                 // 첫 누름은 확인만
  const confirmation = page.getByRole('group', { name: '모두 지우기' });
  await expect(confirmation.getByText('모두 지울까요? 되돌릴 수 없어요')).toBeVisible();
  await confirmation.getByRole('button', { name: '취소' }).click();
  await expect(page.locator('.inbox-row')).toHaveCount(2);
  await clear.click();
  await confirmation.getByRole('button', { name: '모두 지우기' }).click();
  await expect(page.getByText('받은 알림이 없어요')).toBeVisible();
});

test('empty states: alerts on and alerts off with a way to turn them on', async ({ page }) => {
  await setup(page, [], { pushOn: true });
  await bell(page).click();
  await expect(page.getByText('받은 알림이 없어요')).toBeVisible();
  await expect(page.getByText('새 공지 알림을 놓쳐도 여기서 다시 볼 수 있어요')).toBeVisible();
  await page.evaluate(() => { (document.querySelector('notice-app') as unknown as App).pushStatus = 'off'; });
  await expect(page.getByText('알림이 꺼져 있어요')).toBeVisible();
  await page.getByRole('button', { name: '알림 켜기' }).click();
  await expect(page.getByRole('dialog', { name: '알림함', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/view=settings&section=notifications/);
  await expect(page.getByRole('heading', { name: '알림', level: 1, exact: true })).toBeVisible();
});

test('switching the account removes the previous account alerts and logging out clears them', async ({ page }) => {
  await setup(page, [item('1', 'account-a', 5), item('2', 'account-b', 9)]);
  await expect(bell(page)).toHaveAccessibleName('알림함, 안 읽은 알림 1개');
  await bell(page).click();
  await expect(page.locator('dialog.overlay-sheet')).toBeVisible();
  await page.evaluate(async () => { const app = document.querySelector('notice-app') as unknown as App; app.authUserId = 'account-b'; app.syncInboxOwner('account-b', 'account-a'); await new Promise((r) => setTimeout(r, 200)); });
  await expect(page.locator('dialog.overlay-sheet')).toHaveCount(0);
  await expect(bell(page)).toHaveAccessibleName('알림함, 안 읽은 알림 1개');
  await bell(page).click();
  await expect(page.locator('.inbox-row')).toHaveCount(1);
  await expect(page.locator('.inbox-row')).toContainText('알림 2');
  const left = () => page.evaluate(async () => new Promise<string[]>((resolve) => {
    const request = indexedDB.open('keyval-store');
    request.onsuccess = () => { const get = request.result.transaction('keyval').objectStore('keyval').get('inbox:v1'); get.onsuccess = () => resolve(get.result.items.map((i: { owner: string }) => i.owner)); };
  }));
  expect(await left()).toEqual(['account-b']);                             // A의 항목은 저장소에서도 지워졌다
  await page.evaluate(async () => { const app = document.querySelector('notice-app') as unknown as App; app.authUserId = null; app.syncInboxOwner(null, 'account-b'); await new Promise((r) => setTimeout(r, 200)); });
  await expect(page.locator('dialog.overlay-sheet')).toHaveCount(0);
  expect(await left()).toEqual([]);
});

test('the bell is hidden when logged out', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await expect(bell(page)).toHaveCount(0);
});

test('reading or deleting in one tab updates the other tab without waiting for the next push', async ({ page, context }) => {
  await setup(page, [item('1', 'account-a', 5), item('2', 'account-a', 9)]);
  const other = await context.newPage();
  await other.goto('/?api=sample/api/v1');
  await other.locator('notice-rows-screen a.row').first().waitFor();
  await other.evaluate(async () => {
    const app = document.querySelector('notice-app') as unknown as App;
    app.profileStatus = 'unavailable'; app.authUserId = 'account-a'; app.onboardingDismissed = true; app.subscriptionsLoading = false;
    await app.refreshInbox();
  });
  await expect.poll(() => other.evaluate(() => (document.querySelector('notice-app') as unknown as App).inboxUnread)).toBe(2);
  await bell(page).click();
  await page.getByRole('button', { name: '모두 읽음으로 표시' }).click();
  await expect.poll(() => other.evaluate(() => (document.querySelector('notice-app') as unknown as App).inboxUnread)).toBe(0);
  await other.close();
});

test('a stored alert with an unsafe address is not opened', async ({ page }) => {
  await setup(page, [item('1', 'account-a', 5, { url: 'https://evil.example/phish' })]);
  await bell(page).click();
  const popups: string[] = [];
  page.on('popup', (popup) => popups.push(popup.url()));
  await page.locator('.inbox-row').first().locator('.inbox-open').click();
  await expect(page.getByText('이 알림의 주소를 열 수 없어요')).toBeVisible();
  expect(popups).toEqual([]);
});

test('Escape, X and backdrop restore the bell without changing the tab, detail or scroll', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  if (mobile) await page.setViewportSize({ width: 360, height: 780 });
  await setup(page, Array.from({ length: 20 }, (_, index) => item(String(index), 'account-a', index)));
  if (!mobile) await page.locator('notice-rows-screen a.row').nth(1).click();
  const snapshot = () => page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as App;
    return { view: app.view, opened: app.detailOpen, id: app.selectedId, body: scrollY, pane: document.querySelector('.list-pane')!.scrollTop };
  });
  await page.evaluate((mobile) => {
    if (mobile) window.scrollTo(0, 20);
    else document.querySelector('.list-pane')!.scrollTop = 210;
  }, mobile);
  const before = await snapshot();
  expect(mobile ? before.body : before.pane).toBeGreaterThan(0);
  const url = page.url();
  const dialog = page.getByRole('dialog', { name: '알림함', exact: true });
  const close = dialog.getByRole('button', { name: '닫기', exact: true });

  for (const method of ['Escape', 'X', 'backdrop']) {
    await bell(page).click();
    await expect(close).toBeFocused();
    expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect.poll(() => dialog.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: '모두 읽음으로 표시' })).toBeFocused();
    if (method === 'Escape') await page.keyboard.press('Escape');
    else if (method === 'X') await close.click();
    else await page.mouse.click(4, 4);
    await expect(dialog).toHaveCount(0);
    await expect(bell(page)).toBeFocused();
    expect(await snapshot()).toEqual(before);
    expect(page.url()).toBe(url);
  }
});

test('a direct inbox address keeps its settings page and opens the linked notice', async ({ page }) => {
  const id = await setup(page, [item('1', 'account-a', 5)], { direct: true, withNotice: true });
  const settings = page.locator('platform-settings-screen');
  await expect(settings.locator('.inbox-row')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '알림함', level: 1, exact: true })).toBeVisible();
  await expect(page.locator('dialog.overlay-sheet')).toHaveCount(0);
  await expect(page).toHaveURL(/view=settings&section=inbox/);
  await settings.locator('.inbox-open').click();
  await expect.poll(() => page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as App;
    return app.openedId || app.selectedId;
  })).toBe(id);
});
