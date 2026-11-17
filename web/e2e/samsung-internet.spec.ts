import { test, expect, type Page } from '@playwright/test';

test.use({
  userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S948N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/31.0 Chrome/138.0.0.0 Mobile Safari/537.36',
  viewport: { width: 384, height: 832 },
  hasTouch: true,
});

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Samsung Internet simulation runs only in the mobile project');
});

const boot = async (page: Page) => {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
};

const showInstallBanner = async (page: Page) => {
  await page.evaluate(() => Object.assign(document.querySelector('notice-app') as object, {
    authUserId: 'account-a', profileStatus: 'ready', onboardingDismissed: true, pushStatus: 'on',
  }));
};

const settings = async (page: Page) => {
  await page.goto('/?view=settings&api=sample/api/v1');
  await page.locator('platform-settings-screen').waitFor();
  await page.waitForLoadState('networkidle');
  const banner = page.getByRole('region', { name: '앱 설치' });
  if (await banner.isVisible()) await banner.getByRole('button', { name: '확인했어요' }).click();
  await page.locator('platform-settings-screen').getByRole('link', { name: /알림/ }).first().click();
};

test('loads without page errors or horizontal overflow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await boot(page);
  expect(await page.evaluate(() => navigator.userAgent)).toContain('SamsungBrowser/31.0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('shows Samsung menu guidance without an install prompt', async ({ page }) => {
  await boot(page);
  await showInstallBanner(page);
  const banner = page.getByRole('region', { name: '앱 설치' });
  await expect(banner).toContainText('메뉴(≡)');
  await expect(banner).toContainText('‘현재 페이지 추가’ → ‘홈 화면’');
  await expect(banner.getByRole('button', { name: '홈 화면에 추가' })).toHaveCount(0);
});

test('shows the install button when a prompt arrives before app load', async ({ page }) => {
  let resume: () => void = () => {};
  const blocked = new Promise<void>((resolve) => { resume = resolve; });
  await page.route('**/src/main.ts', async (route) => { await blocked; await route.continue(); });
  await page.goto('/?api=sample/api/v1', { waitUntil: 'commit' });
  await page.waitForFunction(() => '__skkuInstallPrompt' in window);
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, { prompt: async () => { (window as unknown as { installCalls: number }).installCalls++; } });
    (window as unknown as { installCalls: number }).installCalls = 0;
    window.dispatchEvent(event);
  });
  resume();
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await showInstallBanner(page);
  await page.getByRole('region', { name: '앱 설치' }).getByRole('button', { name: '홈 화면에 추가' }).click();
  expect(await page.evaluate(() => (window as unknown as { installCalls: number }).installCalls)).toBe(1);
});

for (const shown of [true, false]) {
  test(`test notification ${shown ? 'shows Samsung guidance' : 'reports an unconfirmed notification'}`, async ({ page, context }) => {
    await context.grantPermissions(['notifications'], { origin: 'http://127.0.0.1:5173' });
    await settings(page);
    // The button is hidden without login: inject the display state used by notice-flow.spec.ts.
    await page.evaluate((visible) => {
      // Headless Chromium can report denied even after grantPermissions.
      Object.defineProperty(Notification, 'permission', { configurable: true, value: 'granted' });
      const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
      const notifications: { tag: string }[] = [];
      const registration = {
        scope: location.origin + '/',
        showNotification: async (_title: string, options: NotificationOptions) => { notifications.push({ tag: options.tag! }); },
        getNotifications: async ({ tag }: { tag: string }) => visible ? notifications.filter((n) => n.tag === tag) : [],
      };
      Object.defineProperty(navigator.serviceWorker, 'getRegistration', { configurable: true, value: async () => registration });
      (app.controller as Record<string, unknown>).pushRegistration = null;
      Object.assign(app, { authUserId: 'account-a', profileStatus: 'unavailable', pushStatus: 'on' });
    }, shown);
    expect(await page.evaluate(() => Notification.permission)).toBe('granted');
    expect(await page.evaluate(async () => !!await navigator.serviceWorker.getRegistration())).toBe(true);
    await page.locator('platform-settings-screen').getByRole('button', { name: '테스트 알림 띄우기' }).click();
    await expect(page.locator('.toast')).toContainText(shown ? '삼성 인터넷' : '테스트 알림을 확인하지 못했어요');
  });
}

test('all-new-notices switch is reachable by touch when available', async ({ page }) => {
  await settings(page);
  const toggle = page.locator('platform-settings-screen').getByRole('switch', { name: '모든 새 공지를 소리와 함께 알리기' });
  test.skip(await toggle.count() === 0, 'The switch is hidden without Supabase account data in dev mode');
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toBeVisible();
  expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await toggle.tap();
});
