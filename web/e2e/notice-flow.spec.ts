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

test('subscription filter keeps only the selected school board', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  const rows = page.locator('notice-rows-screen a.row');
  await expect(rows.first()).toBeVisible();
  // 목록이 점진적으로 그려지므로 행 수가 두 번 연속 같을 때까지 기다린 뒤 기준 목록을 잡는다.
  let previous = -1;
  await expect.poll(async () => { const count = await rows.count(); const same = count === previous; previous = count; return same; }, { intervals: [300] }).toBe(true);
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

// 앱 상태를 직접 바꿔 컨트롤러와 화면의 실제 연결을 확인한다. 서버 호출이 필요한 동작은 컨트롤러 메서드를 기록용으로 바꾼다.
type AppHandle = Record<string, unknown>;
const withApp = (page: import('@playwright/test').Page, patch: Record<string, unknown>) => page.evaluate((values) => {
  const app = document.querySelector('notice-app') as unknown as AppHandle;
  const w = window as unknown as { calls: unknown[][] };
  w.calls = [];
  for (const [key, value] of Object.entries(values)) {
    app[key] = typeof value === 'string' && value.startsWith('fn:')
      ? (...args: unknown[]) => { w.calls.push([value.slice(3), ...args]); return Promise.resolve(true); }
      : value;
  }
}, patch);
const calls = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { calls: unknown[][] }).calls);
const settingsAt = async (page: import('@playwright/test').Page, query = '') => {
  await page.goto(`/?view=settings${query}&api=sample/api/v1`);
  await page.locator('platform-settings-screen').waitFor();
};

test('settings hub opens each page in the app, back works and the theme can be changed', async ({ page }) => {
  await settingsAt(page);
  const screen = page.locator('platform-settings-screen');
  for (const name of ['내 설정', '계정', '화면']) await expect(screen.getByRole('heading', { name })).toBeVisible();
  await screen.getByRole('link', { name: /관심 키워드/ }).click();
  await expect(page).toHaveURL(/section=keywords/);
  await expect(screen.getByRole('heading', { name: '관심 키워드' })).toBeVisible();
  await page.goBack();
  await expect(page).not.toHaveURL(/section=/);
  await expect(screen.getByRole('heading', { name: '내 설정' })).toBeVisible();
  await screen.getByRole('radio', { name: '어둡게' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(screen.getByRole('radio', { name: '어둡게' })).toHaveAttribute('aria-checked', 'true');
  await screen.getByRole('radio', { name: '자동' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  await screen.getByRole('link', { name: /알림/ }).first().click();
  await expect(screen.getByRole('link', { name: '설정으로' })).toBeVisible();
  await screen.getByRole('link', { name: '설정으로' }).click();
  await expect(screen.getByRole('heading', { name: '내 설정' })).toBeVisible();
});

test('keywords work like the original: Enter or the button adds, duplicates are ignored and delete is immediate', async ({ page }) => {
  await settingsAt(page, '&section=keywords');
  const screen = page.locator('platform-settings-screen');
  const input = screen.getByRole('textbox', { name: '새 키워드' });
  await input.fill('장학');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await input.fill('  겨울방학   인턴 ');
  await screen.getByRole('button', { name: '추가하기' }).click();
  await input.fill('장학');
  await input.press('Enter');
  const items = screen.locator('.keyword-list li');
  await expect(items).toHaveText(['장학삭제', '겨울방학 인턴삭제']);
  await expect(screen.getByText('로그인하면 다른 기기와 같은 키워드를 써요')).toBeVisible();
  await screen.getByRole('button', { name: '장학 삭제' }).click();
  await expect(items).toHaveText(['겨울방학 인턴삭제']);
  await page.reload();
  await expect(page.locator('platform-settings-screen .keyword-list li')).toHaveText(['겨울방학 인턴삭제']);
  await expect(page.locator('.sidebar')).toContainText('겨울방학 인턴');
});

test('notification settings show each device state and call the right actions', async ({ page }) => {
  await settingsAt(page, '&section=notifications');
  const screen = page.locator('platform-settings-screen');
  await expect(screen.getByText('로그인하면 이 기기로 알림을 받을 수 있어요')).toBeVisible();
  await withApp(page, { authUserId: 'account-a', pushStatus: 'off', subscriptions: [], enablePush: 'fn:enable', disablePush: 'fn:disable', testNotification: 'fn:test' });
  await expect(screen.locator('.setting-state')).toHaveText('꺼짐');
  await screen.getByRole('button', { name: '알림 받기' }).click();
  expect(await calls(page)).toEqual([['enable']]);
  await withApp(page, { pushStatus: 'on' });
  await expect(screen.locator('.setting-state')).toHaveText('켜짐');
  await expect(screen.getByText('받을 게시판을 고르면 새 공지를 알려드려요')).toBeVisible();
  await screen.getByRole('button', { name: '테스트 알림 띄우기' }).click();
  await screen.getByRole('button', { name: '알림 끄기' }).click();
  expect(await calls(page)).toEqual([['test'], ['disable']]);
  await withApp(page, { pushStatus: 'checking' });
  await expect(screen.getByRole('button', { name: '확인하고 있어요' })).toBeDisabled();
  await withApp(page, { pushStatus: 'denied' });
  await expect(screen.getByText('브라우저 설정에서 알림을 허용하면 다시 켤 수 있어요')).toBeVisible();
  await withApp(page, { pushStatus: 'off', pushRetry: true, pushError: '알림을 켜지 못했어요. 다시 시도하면 이어서 진행해요.' });
  await expect(screen.getByRole('alert')).toContainText('다시 시도');
  await screen.getByRole('button', { name: '다시 시도하기' }).click();
  expect(await calls(page)).toEqual([['enable']]);
});

test('board subscriptions are switches grouped by college with search', async ({ page }) => {
  await settingsAt(page, '&section=notifications');
  const screen = page.locator('platform-settings-screen');
  await withApp(page, { authUserId: 'account-a', subscriptions: ['skku-notice01'], toggleSubscription: 'fn:toggle' });
  const mine = screen.getByRole('switch', { checked: true });
  await expect(mine).toHaveCount(1);
  await expect(mine.first()).toContainText('켜짐');
  await mine.first().click();
  await screen.locator('details.connection-manual > summary').click();
  const more = screen.getByRole('switch', { checked: false });
  await expect(more.first()).toBeVisible();
  const search = screen.getByRole('searchbox', { name: '게시판 검색' });
  await search.fill('없는게시판이름');
  await expect(screen.getByText("'없는게시판이름'에 맞는 게시판이 없어요")).toBeVisible();
  await search.fill('');
  await more.first().click();
  const recorded = await calls(page);
  expect(recorded[0]).toEqual(['toggle', 'skku-notice01', false]);
  expect(recorded[1][0]).toBe('toggle');
  expect(recorded[1][2]).toBe(true);
});

test('profile page edits year and status in place and can reopen the first-run setup', async ({ page }) => {
  await settingsAt(page, '&section=profile');
  const screen = page.locator('platform-settings-screen');
  await expect(screen.getByRole('button', { name: 'Google 계정으로 계속하기' })).toBeVisible();
  const profile = { programs: [{ college: '소프트웨어융합대학', department: '소프트웨어학과' }, { college: '경영대학', department: '경영학과' }],
    year: 3, semester: null, enrollmentStatus: '재학', militaryService: null, onboardedAt: '2026-11-07T00:00:00Z' };
  await withApp(page, { authUserId: 'account-a', profile, profileStatus: 'ready', saveProfile: 'fn:save', openOnboarding: 'fn:open' });
  await expect(screen.getByText('소프트웨어학과 (소프트웨어융합대학)')).toBeVisible();
  await withApp(page, { profileStatus: 'unavailable' });
  await expect(screen.getByRole('radio', { name: '4학년' })).toBeDisabled();
  await expect(screen.getByText('지금은 내 정보를 불러올 수 없어요. 잠시 뒤 다시 열어 주세요')).toBeVisible();
  await withApp(page, { profileStatus: 'ready', profileError: '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.' });
  await expect(screen.getByRole('alert')).toContainText('다시 시도');
  await withApp(page, { profileError: '', saveProfile: 'fn:save', openOnboarding: 'fn:open' });
  await expect(screen.getByText('경영학과', { exact: true })).toBeVisible();
  await expect(screen.getByRole('radio', { name: '3학년' })).toHaveAttribute('aria-checked', 'true');
  await screen.getByRole('radio', { name: '4학년' }).click();
  await screen.getByRole('radio', { name: '휴학' }).click();
  await screen.getByRole('button', { name: '전공과 게시판 다시 고르기' }).click();
  const recorded = await calls(page);
  expect(recorded[0]).toEqual(['save', { ...profile, year: 4 }]);
  expect(recorded[1]).toEqual(['save', { ...profile, enrollmentStatus: '휴학' }]);
  expect(recorded[2]).toEqual(['open']);
});

test('Gemini key page registers once, never shows the key again and hides the key box when unavailable', async ({ page }) => {
  await settingsAt(page, '&keys=1');
  const screen = page.locator('platform-settings-screen');
  await withApp(page, { authUserId: 'account-a', byokOn: false, registerKey: 'fn:register', removeKey: 'fn:remove', saveProfile: 'fn:profile', profileStatus: 'ready', onboardingDismissed: true });
  await expect(screen.getByRole('heading', { name: 'Gemini 키' })).toHaveCount(0);
  await expect(screen.getByRole('heading', { name: '지원 자격 확인용 정보' })).toBeVisible();
  await withApp(page, { byokOn: true, byokLoading: false, byokStatus: null });
  const button = screen.getByRole('button', { name: '키 등록하기' });
  await expect(button).toBeDisabled();
  const key = `AIza${'D'.repeat(35)}`;
  const input = screen.getByLabel('Gemini API 키');
  await expect(input).toHaveAttribute('type', 'password');
  await input.fill(key);
  await button.click();
  expect(await calls(page)).toEqual([['register', key]]);
  await screen.getByRole('radio', { name: '2학기' }).click();
  expect((await calls(page)).at(-1)?.[0]).toBe('profile');
  await withApp(page, { byokStatus: { keyHint: 'DDDD', model: 'm', disabled: false, lastError: null, usedToday: 0 } });
  await expect(screen.getByText('등록된 키 ····DDDD')).toBeVisible();
  expect(await screen.innerText()).not.toContain(key);
  await expect(screen.getByLabel('Gemini API 키')).toHaveCount(0);
  await withApp(page, { byokStatus: { keyHint: 'DDDD', model: 'm', disabled: true, lastError: 'Gemini가 이 키를 받아 주지 않아요. 키를 다시 등록해 주세요.', usedToday: 0 } });
  await expect(screen.getByRole('alert')).toContainText('다시 등록');
  await screen.getByRole('button', { name: '키 지우기' }).click();
  expect(await calls(page)).toEqual([['remove']]);
});

test('first-run setup: choices only, department list follows the college, double major is optional and the draft is what gets saved', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    const w = window as unknown as { calls: unknown[][] };
    w.calls = [];
    app.finishOnboarding = (draft: unknown) => { w.calls.push(['finish', draft]); return Promise.resolve(true); };
    app.closeOnboarding = () => { w.calls.push(['close']); app.onboardingOpen = false; app.profile = { ...(app.profile as object), onboardedAt: 'x' }; };
    app.enablePush = () => { w.calls.push(['push']); return Promise.resolve(); };
    app.profile = { programs: [], year: null, semester: null, enrollmentStatus: null, militaryService: null, onboardedAt: null };
    app.profileStatus = 'ready';
    app.pushStatus = 'off';
    app.authUserId = 'account-a';
  });
  const dialog = page.getByRole('dialog');
  await expect(page.locator('.app')).toHaveAttribute('inert', '');
  await expect(dialog.getByRole('heading', { name: '주전공이 어디예요?' })).toBeFocused();
  await expect(dialog.getByRole('heading', { name: '주전공이 어디예요?' })).toBeVisible();
  await expect(dialog.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  // 대학 → 학과: 고른 대학의 학과만 보인다.
  await dialog.getByRole('button', { name: '소프트웨어융합대학', exact: true }).click();
  // 질문 제목이 접히지 않고 보여야 한다(전역 h1 규칙이 제목 높이를 0으로 만들던 결함의 재발 방지).
  const title = dialog.getByRole('heading', { name: '주전공이 어디예요?' });
  expect((await title.boundingBox())!.height).toBeGreaterThan(20);
  await expect(dialog.getByRole('button', { name: '소프트웨어학과', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '국어국문학과', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '대학 다시 고르기' }).click();
  await dialog.getByRole('button', { name: '문과대학', exact: true }).click();
  await expect(dialog.getByRole('searchbox', { name: '학과 검색' })).toBeVisible();
  await dialog.getByRole('searchbox', { name: '학과 검색' }).fill('철학');
  await expect(dialog.getByRole('button', { name: '철학과', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '사학과', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '대학 다시 고르기' }).click();
  await dialog.getByRole('button', { name: '소프트웨어융합대학', exact: true }).click();
  await dialog.getByRole('button', { name: '소프트웨어학과', exact: true }).click();      // 목록 항목이 곧 다음 단계
  // 복수전공은 선택이다.
  await expect(dialog.getByRole('heading', { name: '복수전공이 있나요?' })).toBeFocused();
  await dialog.getByRole('button', { name: '복수전공이 있어요' }).click();
  await dialog.getByRole('button', { name: '경영대학', exact: true }).click();
  await dialog.getByRole('button', { name: '경영학과', exact: true }).click();
  await expect(dialog.getByText('경영학과', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '다음' }).click();
  // 학년·재학 상태: 재학이 미리 골라져 있고 학년을 골라야 넘어간다.
  await expect(dialog.getByRole('button', { name: '재학', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: '다음' })).toBeDisabled();
  await dialog.getByRole('button', { name: '3학년' }).click();
  await dialog.getByRole('button', { name: '다음' }).click();
  // 게시판·키워드: 내 전공에 맞춰 추천이 켜져 있다.
  await expect(dialog.getByRole('heading', { name: '받을 공지를 골라 주세요' })).toBeFocused();
  await expect(dialog.getByRole('switch', { name: /^성균관대 공지 추천/ })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('switch', { name: /^소프트웨어학과 공지 추천/ })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('button', { name: '장학' }).click();
  await dialog.getByRole('button', { name: '저장하고 다음' }).click();
  const saved = (await calls(page)).find((call) => call[0] === 'finish')![1] as Record<string, unknown>;
  expect(saved).toMatchObject({
    programs: [{ college: '소프트웨어융합대학', department: '소프트웨어학과' }, { college: '경영대학', department: '경영학과' }],
    year: 3, enrollmentStatus: '재학', keywords: ['장학'],
  });
  expect(saved.boards).toEqual(expect.arrayContaining(['skku-notice01', 'cse-notice']));
  // 알림은 나중에 해도 된다.
  await expect(dialog.getByRole('heading', { name: '알림을 켜 둘까요?' })).toBeFocused();
  await dialog.getByRole('button', { name: '나중에 할게요' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.app')).not.toHaveAttribute('inert', '');
});

test('first-run setup can be skipped and then stays out of the way; it can be reopened from settings', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    app.profile = { programs: [], year: null, semester: null, enrollmentStatus: null, militaryService: null, onboardedAt: null };
    app.profileStatus = 'ready';
    app.authUserId = 'account-a';
  });
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '나중에 하기' }).click();
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => { (document.querySelector('notice-app') as unknown as { profileStatus: string }).profileStatus = 'ready'; });
  await expect(dialog).toHaveCount(0);
  await page.goto('/?view=settings&section=profile&api=sample/api/v1');
  await page.locator('platform-settings-screen').waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as Record<string, unknown>;
    app.profileStatus = 'ready'; app.authUserId = 'account-a'; app.onboardingDismissed = true;
  });
  await page.getByRole('button', { name: '전공과 게시판 다시 고르기' }).click();
  await expect(dialog.getByRole('button', { name: '닫기' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
