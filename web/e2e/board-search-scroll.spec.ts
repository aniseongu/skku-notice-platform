import { test, expect } from '@playwright/test';
import { BOARD_CATALOG, OTHER_BOARDS } from '../src/skku-boards';

test('board search keeps its position when the result list shrinks', async ({ page }) => {
  await page.goto('/?view=settings&section=notifications&api=sample/api/v1');
  await page.locator('platform-settings-screen').waitFor();
  await page.waitForLoadState('networkidle');
  await page.evaluate(({ catalog, other }) => {
    const app = document.querySelector('notice-app') as any;
    app.sources = [{ id: 'skku-notice01', name: '성균관대 공지', url: 'https://www.skku.edu/' }, ...catalog, ...other.map((b) => ({...b, url:'https://example.com/'})).filter((b) => !catalog.some((c) => c.id === b.id))];
    app.authUserId = 'account-a'; app.profileStatus = 'unavailable'; app.subscriptions = ['skku-notice01']; app.subscriptionsLoading = false;
  }, { catalog: BOARD_CATALOG, other: OTHER_BOARDS });
  const details = page.locator('details.board-more-list');
  await details.locator('summary').click();
  const search = details.getByRole('searchbox');
  await search.evaluate((input) => input.scrollIntoView({ block: 'start' }));
  const before = await search.evaluate((input) => input.getBoundingClientRect().top);
  await search.fill('없는게시판');
  await expect(details.getByRole('status')).toBeVisible();
  const after = await search.evaluate((input) => input.getBoundingClientRect().top);
  expect(Math.abs(after - before)).toBeLessThan(2);
  await search.fill('');
  const groups = details.getByRole('group', { name: '단과대와 기타 묶음 선택' });
  await groups.getByRole('button', { name: '기타 · 부트캠프' }).click();
  await expect(details.getByRole('button', { name: '인공지능 부트캠프 추가' })).toBeVisible();
});
