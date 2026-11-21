import { test, expect } from '@playwright/test';

test('cached list appears before the feed and stays isolated by account', async ({ page }) => {
  await page.route('**/src/auth.ts*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    const session = () => ({ user: { id: localStorage.getItem('test-user') || 'a', user_metadata: {} } });
    const query = (table) => {
      const result = () => table === 'user_profiles' ? {data: null, error: {message: 'unavailable'}} : table === 'user_source_subscriptions' ? {data: [{source_id: 'skku-notice01'}], error: null} : {data: [], error: null};
      const q = new Proxy({}, { get(_, prop) { if (prop === 'then') return (resolve) => resolve(result()); if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve(result()); return () => q; } });
      return q;
    };
    let authCallback;
    export const authClient = { auth: { onAuthStateChange(cb) { authCallback = cb; setTimeout(() => cb('INITIAL_SESSION', session()), 0); return {data: {subscription: {unsubscribe() {}}}}; }, getSession: async () => ({data: {session: session()}}), signOut: async () => { authCallback('SIGNED_OUT', null); return {error: null}; } }, from: query, rpc: async () => ({data: [], error: null}), functions: {invoke: async () => ({data: null, error: null})} };
  ` }));
  const feedPath = '**/sample/api/v1/notices.json';
  let feedGate: Promise<void> | undefined;
  const holdFeed = () => {
    let release!: () => void;
    feedGate = new Promise<void>((resolve) => { release = resolve; });
    return release;
  };
  await page.route(feedPath, async (route) => {
    await feedGate;
    await route.continue();
  });
  await page.addInitScript(() => { localStorage.setItem('platform:onboarded:a', '1'); localStorage.setItem('platform:onboarded:b', '1'); });
  await page.goto('/?api=sample/api/v1');
  const rows = page.locator('notice-rows-screen a.row');
  await expect(rows.first()).toBeVisible();
  await page.waitForFunction(async () => {
    const { loadListCache } = await import('/src/list-cache.ts');
    return !!(await loadListCache('a'));
  });
  const releaseWarmFeed = holdFeed();
  try {
    await page.reload();
    await expect(rows.first()).toBeVisible();
  } finally {
    releaseWarmFeed();
  }
  await page.evaluate(() => localStorage.setItem('test-user', 'b'));
  const releaseNewAccountFeed = holdFeed();
  try {
    await Promise.all([page.waitForRequest(feedPath), page.reload()]);
    await expect(rows).toHaveCount(0);
  } finally {
    releaseNewAccountFeed();
  }
  await expect(rows.first()).toBeVisible();
  await page.waitForFunction(async () => {
    const { loadListCache } = await import('/src/list-cache.ts');
    return !!(await loadListCache('b'));
  });
  await page.evaluate(async () => { await (document.querySelector('notice-app') as unknown as { signOut(): Promise<void> }).signOut(); });
  await expect.poll(() => page.evaluate(async () => {
    const { loadListCache } = await import('/src/list-cache.ts');
    return await loadListCache('b');
  })).toBeNull();
});
