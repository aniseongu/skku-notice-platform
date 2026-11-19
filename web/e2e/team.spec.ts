import { test, expect, type Page } from '@playwright/test';

type App = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// 서버 없이 컨트롤러와 화면의 실제 연결을 본다. 서버 대신 메모리 가짜(서버 규칙을 흉내)를 끼운다.
async function setup(page: Page, seed: Record<string, unknown>[] = [], contact: string | null = null) {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.waitForLoadState('networkidle');
  await page.locator('notice-rows-screen a.row', { hasText: '공모전' }).first().click();
  await page.evaluate(({ seed, contact }) => {
    const app = document.querySelector('notice-app') as unknown as App;
    const w = window as unknown as { who: string; db: { posts: any[]; apps: any[]; contact: string | null } };
    w.who = 'a'; w.db = { posts: seed, apps: [], contact };
    const fail = (code: string) => { throw new Error(code); };
    const view = (p: any) => ({ id: p.id, role: p.role, capacity: p.capacity, approved: w.db.apps.filter((x) => x.post === p.id && x.status === 'approved').length,
      intro: p.intro, state: p.state ?? 'open', closesAt: 'x', mine: p.owner === w.who, hidden: false,
      myStatus: w.db.apps.find((x) => x.post === p.id && x.who === w.who)?.status ?? null });
    app.controller.teamApiOverride = {
      list: async () => w.db.posts.map(view),
      create: async (_n: string, d: any) => { w.db.posts.push({ id: `p${w.db.posts.length + 1}`, owner: w.who, ...d }); },
      apply: async (id: string, message: string) => { w.db.apps.push({ id: `x${w.db.apps.length + 1}`, post: id, who: w.who, status: 'pending', message, no: w.db.apps.length + 1 }); },
      withdraw: async (id: string) => { w.db.apps.find((x) => x.post === id && x.who === w.who).status = 'withdrawn'; },
      setStatus: async (id: string, s: string) => { w.db.posts.find((p) => p.id === id).state = s; },
      remove: async (id: string) => { w.db.posts = w.db.posts.filter((p) => p.id !== id); },
      applicants: async (id: string) => w.db.apps.filter((x) => x.post === id).map((x) => ({ id: x.id, anonNo: x.no, message: x.message || null, status: x.status })),
      decide: async (id: string, d: string) => { if (d === 'approved' && !w.db.contact) fail('team_contact_required'); w.db.apps.find((x) => x.id === id).status = d; },
      setContact: async (_p: string, c: string) => { w.db.contact = c; },
      contact: async () => w.db.contact,
      report: async () => {}, blockOwner: async () => {}, blockApplicant: async () => {},
    };
    app.profileStatus = 'unavailable'; app.authUserId = 'account-a'; app.onboardingDismissed = true;
    app.subscriptions = app.sources.map((s: { id: string }) => s.id); app.subscriptionsLoading = false;
  }, { seed, contact });
  await page.waitForTimeout(600);   // 계정 초기화가 끝난 뒤 다시 읽는다
  await page.evaluate(() => { const app = document.querySelector('notice-app') as unknown as App; app.loadTeam(app.notices.find((n: { title: string }) => n.title.includes('공모전')).id); });
}
const as = (page: Page, who: string) => page.evaluate((id) => {
  (window as unknown as { who: string }).who = id;
  const app = document.querySelector('notice-app') as unknown as App;
  app.loadTeam(app.teamState.noticeId);
}, who);

test('empty state, make a team, apply, approve with contact once, then see the contact', async ({ page }) => {
  await setup(page);
  await expect(page.locator('section.team')).toHaveCount(1);   // 공지 상세에는 팀 구역이 하나만 그려진다
  const section = page.getByRole('region', { name: '팀원 모집' });
  const head = section.getByRole('button', { name: /^팀원 모집(\s|$)/ });
  await expect(head).toHaveAttribute('aria-expanded', 'false');          // 기본은 접힌 한 줄
  expect((await head.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await head.click();
  await expect(section.getByText('이 공고로 팀을 만들어 봐요')).toBeVisible();   // 빈 상태 한 줄
  await section.getByRole('button', { name: '팀원 모집하기' }).click();
  await expect(section.getByRole('button', { name: '모집 올리기' })).toBeDisabled();   // 역할·소개가 있어야 한다
  await section.getByLabel('역할').fill('백엔드 개발');
  await section.getByLabel('한 줄 소개').fill('같이 만들어 봐요');
  await section.getByRole('button', { name: '모집 올리기' }).click();
  await expect(section.getByRole('heading', { name: '백엔드 개발' })).toBeVisible();
  await expect(section.getByText('내 모집')).toBeVisible();
  // 신청자: 탭 한 번
  await as(page, 'b');
  await section.getByRole('button', { name: '신청할래요' }).click();
  await expect(section.getByText('신청했어요')).toBeVisible();
  // 모집자: 승인 → 연락처 한 번 → 승인
  await as(page, 'a');
  await section.getByRole('button', { name: '신청자 보기' }).click();
  await expect(section.getByText('익명 1')).toBeVisible();
  await section.getByRole('button', { name: '승인', exact: true }).click();
  await section.getByLabel(/승인한 분께만/).fill('https://open.kakao.com/o/abc');
  await section.getByRole('button', { name: '저장하고 승인' }).click();
  await expect(section.getByText('승인함')).toBeVisible();
  // 승인된 사람만 연락처를 본다
  await as(page, 'b');
  await expect(section.getByText('승인됐어요')).toBeVisible();
  await expect(section.locator('a')).toHaveCount(0);                      // 누르기 전에는 연락처가 없다
  await section.getByRole('button', { name: '연락처 보기' }).click();
  const link = section.getByRole('link', { name: 'https://open.kakao.com/o/abc' });
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  await expect(link).toHaveAttribute('target', '_blank');
});

test('a javascript: contact is shown as plain text, never a link', async ({ page }) => {
  await setup(page, [{ id: 'p1', owner: 'a', role: '디자인', capacity: 2, intro: '소개', state: 'open' }], 'javascript:alert(1)');
  await page.evaluate(() => { const w = window as unknown as { db: any }; w.db.apps.push({ id: 'x1', post: 'p1', who: 'b', status: 'approved', no: 1 }); });
  await as(page, 'b');
  const section = page.getByRole('region', { name: '팀원 모집' });
  const head = section.getByRole('button', { name: /^팀원 모집(\s|$)/ });
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();   // 내가 낀 팀이면 저절로 열린다
  await section.getByRole('button', { name: '연락처 보기' }).click();
  await expect(section.getByText('javascript:alert(1)')).toBeVisible();
  await expect(section.locator('a')).toHaveCount(0);
});

test('team section is hidden for notices that are not team-like and when the feature is missing', async ({ page }) => {
  await setup(page);
  await expect(page.getByRole('region', { name: '팀원 모집' })).toBeVisible();
  await page.evaluate(() => { (document.querySelector('notice-app') as unknown as App).teamUnavailable = true; });
  await expect(page.getByRole('region', { name: '팀원 모집' })).toHaveCount(0);
});
