import { expect, test, type Page } from '@playwright/test';

const baseline = process.env.SETTINGS_PERF_BASELINE === '1';
const accountA = 'settings-a';
const accountB = 'settings-b';
const nameA = '테스트 계정 A';
const nameB = '테스트 계정 B';
const avatar = 'https://lh3.googleusercontent.com/settings-test-photo';
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function user(id: string) {
  return { id, aud: 'authenticated', email: `${id}@example.test`, user_metadata: { full_name: id === accountA ? nameA : nameB, avatar_url: avatar } };
}

function session(id: string) {
  const expires_at = Math.floor(Date.now() / 1000) + 3600;
  const claims = Buffer.from(JSON.stringify({ sub: id, exp: expires_at })).toString('base64url');
  return { access_token: `e30.${claims}.Zml4dHVyZQ`, refresh_token: 'fixture', expires_at, token_type: 'bearer', user: user(id) };
}

async function mockAccount(page: Page) {
  let profileDelay: Promise<void> | undefined;
  let startProfileDelay: (() => void) | undefined;
  let yearA = 3;
  await page.exposeFunction('startSettingsProfileDelay', () => startProfileDelay?.());
  await page.addInitScript(({ sessionA, ids }) => {
    if (!sessionStorage.getItem('settings-test-seeded')) {
      localStorage.setItem('sb-127-auth-token', JSON.stringify(sessionA));
      sessionStorage.setItem('settings-test-seeded', '1');
    }
    for (const id of ids) localStorage.setItem(`platform:onboarded:${id}`, '1');
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined });
    Reflect.deleteProperty(window, 'PushManager');
  }, { sessionA: session(accountA), ids: [accountA, accountB] });
  await page.route(/\/src\/auth\.ts$/, (route) => route.fulfill({ contentType: 'text/javascript', body: `
    export { createAuthClient } from '/src/auth.ts?fixture';
    import { createAuthClient } from '/src/auth.ts?fixture';
    export const authClient = createAuthClient(location.origin, 'sb_publishable_fixture');
  ` }));
  await page.route(/\/src\/byok\.ts$/, (route) => route.fulfill({ contentType: 'text/javascript', body: `
    export * from '/src/byok.ts?fixture';
    export const byokAvailable = async () => true;
    export const checkByokAvailability = byokAvailable;
  ` }));
  await page.route('**/auth/v1/logout?**', (route) => route.fulfill({ status: 204 }));
  await page.route('**/auth/v1/token?**', (route) => route.fulfill({ json: { ...session(accountB), expires_in: 3600 } }));
  await page.route('**/rest/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const id = url.searchParams.get('user_id')?.slice(3);
    const select = url.searchParams.get('select');
    const table = url.pathname.split('/').at(-1);
    const isA = id === accountA;
    let json: object | number | null = [];
    switch (table) {
      case 'user_profiles':
        // Keep the request pending until the settings click, even when page setup is slow.
        if (profileDelay) {
          await profileDelay;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        json = {
          programs: [isA ? { college: '경영대학', department: '경영학과' } : { college: '경제대학', department: '경제학과' }],
          year: isA ? yearA : 2, semester: 1, enrollment_status: '재학', military_service: '해당 없음',
          university_3p_internship_selected: false, dept_internship_done: false, university_3p_internship_done: false,
          onboarded_at: '2026-01-01',
        };
        break;
      case 'user_push_subscriptions':
        json = [{ id: `device-${id}`, endpoint: 'https://push.example.test/secret-fixture', device_name: `device-${id}`, canvas_mode: 'off' }];
        break;
      case 'user_byok_keys': json = isA ? { key_hint: 'abcd', disabled_at: null, model: 'fixture', used_today: 0 } : null; break;
      case 'user_ai_preferences': json = { ai_enabled: true }; break;
      case 'user_canvas_tokens': json = select === 'summary_time' ? { summary_time: '21:00' } : null; break;
      case 'user_calendar': json = isA ? { calendar_id: 'fixture-calendar', synced_at: null } : null; break;
      case 'user_google_tokens': json = null; break;
      case 'user_preferences': json = { keywords: [`keyword-${id}`], board_order: [], saved_order: [] }; break;
      case 'my_byok_backfill_count': json = 0; break;
    }
    await route.fulfill({ json });
  });
  await page.route(avatar, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 650));
    await route.fulfill({ contentType: 'image/png', body: pixel, headers: { 'Cache-Control': 'public, max-age=600' } });
  });
  return {
    slowProfile: () => { profileDelay = new Promise<void>((resolve) => { startProfileDelay = resolve; }); },
    startProfileDelay: () => startProfileDelay?.(),
    changeProfile: () => { yearA = 4; },
  };
}

function settingsButton(page: Page, mobile: boolean) {
  return mobile ? page.getByRole('button', { name: '설정', exact: true }) : page.locator('.side-foot').getByRole('button', { name: '설정' });
}

const openList = (page: Page) => page.goto('/?api=sample/api/v1');

async function startMeasurement(page: Page, mobile: boolean) {
  await settingsButton(page, mobile).evaluate((button) => {
    button.addEventListener('click', () => {
      const start = performance.now();
      void (window as unknown as { startSettingsProfileDelay(): Promise<void> }).startSettingsProfileDelay();
      const shifts: number[] = [];
      const positions: { x: number; y: number }[] = [];
      let account: number | null = null;
      let body: number | null = null;
      let frame = 0;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
          if (entry.startTime >= start && !entry.hadRecentInput) shifts.push(entry.value);
        }
      });
      observer.observe({ type: 'layout-shift' });
      const sample = () => {
        const row = document.querySelector<HTMLElement>('.account-row');
        const heading = document.querySelector<HTMLElement>('#s-preferences');
        if (row && getComputedStyle(row).visibility === 'visible') {
          account ??= performance.now() - start;
          const { x, y } = row.getBoundingClientRect();
          positions.push({ x, y });
        }
        if (heading && getComputedStyle(heading).visibility === 'visible') body ??= performance.now() - start;
        frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
      Object.assign(window, { finishSettingsMeasurement: () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        return {
          account: account === null ? null : Math.round(account),
          body: body === null ? null : Math.round(body),
          cls: shifts.reduce((total, shift) => total + shift, 0),
          accountMovement: Math.max(...positions.map(({ x, y }) => Math.hypot(x - positions[0].x, y - positions[0].y))),
        };
      } });
    }, { capture: true, once: true });
  });
  await settingsButton(page, mobile).click();
}

const finishMeasurement = (page: Page) => page.evaluate(async () => {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return (window as unknown as { finishSettingsMeasurement(): { account: number | null; body: number | null; cls: number; accountMovement: number } }).finishSettingsMeasurement();
});

const readCache = (page: Page, id: string) => page.evaluate(async (userId) => {
  if (!(await indexedDB.databases()).some((db) => db.name === 'keyval-store')) return null;
  return new Promise<Record<string, unknown> | null>((resolve, reject) => {
    const open = indexedDB.open('keyval-store');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction('keyval').objectStore('keyval').get(`settings-cache:${userId}`);
      read.onsuccess = () => { db.close(); resolve(read.result?.data ?? null); };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  });
}, id);

test('settings paint with a fixed account row and restore a warm cache before the server', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile';
  const mock = await mockAccount(page);
  mock.slowProfile();
  await openList(page);
  await startMeasurement(page, mobile);
  const account = page.locator('.account-row');
  const body = page.getByRole('heading', { name: '내 설정' });
  const profile = page.getByRole('link', { name: /프로필 설정/ });
  if (!baseline) {
    await expect(account).toContainText(nameA);
    await expect(account).toContainText('settings-a@example.test');
    await expect(account.locator('.avatar')).toHaveCSS('width', '56px');
    await expect(account.locator('.avatar')).toHaveCSS('height', '56px');
    await expect(body).toBeHidden();
  }
  await expect(body).toBeVisible();
  await expect(profile).toContainText('3학년');
  await expect(account.locator('.avatar')).toHaveAttribute('data-loaded', 'true');
  const cold = await finishMeasurement(page);

  if (!baseline) await expect.poll(async () => (await readCache(page, accountA))?.profile).toBeDefined();
  mock.changeProfile();
  mock.slowProfile();
  // Re-enter using a fresh document in the same browser context to exercise IndexedDB restoration.
  await openList(page);
  await startMeasurement(page, mobile);
  if (!baseline) await expect(profile).toContainText('3학년');
  await expect(profile).toContainText('4학년');
  await expect(account.locator('.avatar')).toHaveAttribute('data-loaded', 'true');
  const warm = await finishMeasurement(page);
  console.log(`settings-performance ${testInfo.project.name} ${JSON.stringify({ cold, warm })}`);
  expect(cold.cls).toBe(0);
  expect(warm.cls).toBe(0);
  expect(cold.accountMovement).toBe(0);
  expect(warm.accountMovement).toBe(0);
  if (!baseline) {
    expect(cold.account).not.toBeNull();
    expect(cold.account!).toBeLessThan(100);
    expect(warm.body).not.toBeNull();
    expect(warm.body!).toBeLessThanOrEqual(100);
    await expect.poll(async () => (await readCache(page, accountA))?.profile).toMatchObject({ year: 4 });
  }
});

test('logout deletes the cache and the next account never renders the previous one', async ({ page }, testInfo) => {
  test.skip(baseline, 'The baseline has no settings cache.');
  const mobile = testInfo.project.name === 'mobile';
  const mock = await mockAccount(page);
  await openList(page);
  await settingsButton(page, mobile).click();
  await expect(page.getByRole('link', { name: /프로필 설정/ })).toContainText('경영학과');
  await expect.poll(async () => (await readCache(page, accountA))?.profile).toBeDefined();
  expect(JSON.stringify(await readCache(page, accountA))).not.toContain('secret-fixture');
  await page.getByRole('button', { name: '이 기기에서 로그아웃' }).click();
  await expect(page.getByRole('button', { name: 'Google로 계속하기' })).toBeVisible();
  await expect.poll(() => readCache(page, accountA)).toBeNull();

  mock.slowProfile();
  await page.evaluate(async () => {
    const observed: string[] = [];
    const scan = () => {
      const settings = document.querySelector('platform-settings-screen');
      if (settings) observed.push(settings.textContent ?? '');
    };
    new MutationObserver(scan).observe(document.body, { childList: true, characterData: true, subtree: true });
    Object.assign(window, { observedSettings: observed });
    const authModule = '/src/auth.ts';
    const { authClient } = await import(authModule);
    const { error } = await authClient.auth.signInWithPassword({ email: 'settings-b@example.test', password: 'fixture-password' });
    if (error) throw error;
  });
  mock.startProfileDelay();
  const account = page.locator('.account-row');
  const open = settingsButton(page, mobile);
  await expect(open.or(account).first()).toBeVisible();
  if (!(await account.isVisible())) await open.click();
  await expect(account).toContainText(nameB);
  await expect(page.getByRole('link', { name: /프로필 설정/ })).toContainText('경제학과');
  const observed = await page.evaluate(() => (window as unknown as { observedSettings: string[] }).observedSettings.join('\n'));
  expect(observed).toContain(nameB);
  expect(observed).not.toMatch(/테스트 계정 A|settings-a@example\.test|경영학과|Gemini 연결됨/);
  await expect.poll(async () => (await readCache(page, accountB))?.profile).toMatchObject({ year: 2 });
  expect(await readCache(page, accountA)).toBeNull();
});
