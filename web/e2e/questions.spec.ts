import { test, expect, type Page } from '@playwright/test';

type App = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// 서버 없이 컨트롤러와 화면의 실제 연결을 본다. 서버 대신 메모리 가짜를 끼운다.
async function setup(page: Page) {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.waitForLoadState('networkidle');
  await page.locator('notice-rows-screen a.row').first().click();
  await page.evaluate(() => {
    const app = document.querySelector('notice-app') as unknown as App;
    const db = { questions: [] as any[], reviews: [] as any[] };
    (window as unknown as { qdb: typeof db }).qdb = db;
    const summary = (key: string) => { const v = db.reviews.map((r) => r[key]).filter(Boolean); return { average: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, count: v.length }; };
    app.controller.qeApiOverride = {
      listQuestions: async () => db.questions.map((q) => ({ id: q.id, parentId: q.parentId ?? null, body: q.body, anonNo: 1, createdAt: '', mine: true, hidden: false, detached: false })),
      listExperiences: async () => ({ posts: db.reviews.map((r) => ({ id: r.id, body: r.body ?? null, satisfaction: r.satisfaction, learning: r.learning ?? null, difficulty: null, participated: !!r.participated, mine: true, hidden: false })),
        count: db.reviews.length, satisfaction: summary('satisfaction'), learning: summary('learning'), difficulty: summary('difficulty') }),
      createQuestion: async (_n: string, body: string, parentId?: string) => { db.questions.push({ id: `q${db.questions.length + 1}`, body, parentId }); return 'x'; },
      createExperience: async (_n: string, input: any) => { db.reviews.push({ id: `r${db.reviews.length + 1}`, ...input }); return 'x'; },
      deletePost: async (id: string) => { db.questions = db.questions.filter((q) => q.id !== id); db.reviews = db.reviews.filter((r) => r.id !== id); },
      report: async () => {}, blockAuthor: async () => 'b',
    };
    app.profileStatus = 'unavailable'; app.authUserId = 'account-a'; app.onboardingDismissed = true;
    app.subscriptions = app.sources.map((s: { id: string }) => s.id); app.subscriptionsLoading = false;
  });
  await page.waitForTimeout(600);
}

test('empty state, leave a star-only review, ask a question and answer it', async ({ page }) => {
  await setup(page);
  await expect(page.locator('section.qe')).toHaveCount(1);   // 상세에는 구역이 하나만 그려진다
  const section = page.getByRole('region', { name: /질문·경험/ });
  const head = section.getByRole('button', { name: /^질문·경험/ });
  await expect(head).toHaveAttribute('aria-expanded', 'false');   // 기본은 접힌 한 줄
  expect((await head.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await head.click();
  await expect(section.getByText(/아직 남은 글이 없어요/)).toBeVisible();   // 빈 방처럼 보이지 않게 안내
  await section.getByRole('button', { name: '후기 남기기' }).first().click();
  const form = section.getByRole('form', { name: '후기 남기기' });
  await expect(form.getByRole('button', { name: '후기 남기기' })).toBeDisabled();   // 별점이 필요하다
  await form.getByRole('radio', { name: '업무 만족 4점' }).click();
  await form.getByRole('button', { name: '후기 남기기' }).click();   // 별점만으로 끝: 클릭 2번
  await expect(section.getByText('후기 1개')).toBeVisible();
  await expect(section.getByText('4.0').first()).toBeVisible();
  await expect(section.getByText('내 후기')).toBeVisible();
  await expect(section.getByRole('button', { name: '후기 남기기' })).toHaveCount(0);   // 이미 남겼다

  await section.getByRole('button', { name: '질문하기' }).click();
  await section.getByRole('textbox', { name: '질문하기' }).fill('서류는 언제까지 내나요?');
  await section.getByRole('button', { name: '질문하기' }).last().click();
  await expect(section.getByText('서류는 언제까지 내나요?')).toBeVisible();
  await section.getByRole('button', { name: '답하기' }).click();
  await section.getByRole('textbox', { name: '답 남기기' }).fill('금요일까지예요');
  await section.getByRole('button', { name: '답 남기기' }).last().click();
  await expect(section.getByText('금요일까지예요')).toBeVisible();
  // 삭제는 확인 한 단계
  await section.getByRole('button', { name: '삭제' }).first().click();
  await expect(section.getByText(/지울까요/)).toBeVisible();
});

test('draft survives closing the review form', async ({ page }) => {
  await setup(page);
  const section = page.getByRole('region', { name: /질문·경험/ });
  await section.getByRole('button', { name: /^질문·경험/ }).click();
  await section.getByRole('button', { name: '후기 남기기' }).first().click();
  const form = section.getByRole('form', { name: '후기 남기기' });
  await form.getByRole('radio', { name: '업무 만족 5점' }).click();
  await form.getByRole('button', { name: '닫기' }).click();
  await section.getByRole('button', { name: '후기 남기기' }).first().click();
  await expect(section.getByRole('form', { name: '후기 남기기' }).getByRole('radio', { name: '업무 만족 5점' })).toHaveAttribute('aria-checked', 'true');
});

test('"더 보기" only appears on long review bodies; star-only review has one submit button', async ({ page }) => {
  await setup(page);
  const section = page.getByRole('region', { name: /질문·경험/ });
  await section.getByRole('button', { name: /^질문·경험/ }).click();
  await section.getByRole('button', { name: '후기 남기기' }).first().click();
  const form = section.getByRole('form', { name: '후기 남기기' });
  await expect(form.getByText('필수')).toBeVisible();
  await expect(form.getByRole('button', { name: '후기 남기기' })).toHaveCount(1);   // 접힌 상태에서도 제출 단추는 하나
  await form.getByRole('button', { name: /더 남기기/ }).click();
  await expect(form.getByText('선택').first()).toBeVisible();
  await expect(form.getByRole('button', { name: '후기 남기기' })).toHaveCount(1);   // 펼쳐도 하나
  await form.getByRole('radio', { name: '업무 만족 4점' }).click();
  await form.getByRole('textbox').fill('짧은 후기예요');
  await form.getByRole('button', { name: '후기 남기기' }).click();
  await expect(section.getByText('짧은 후기예요')).toBeVisible();
  await expect(section.getByRole('button', { name: '더 보기' })).toHaveCount(0);   // 짧은 글에는 없다
});

test('a long review body is clamped and "더 보기" expands it', async ({ page }) => {
  await setup(page);
  const section = page.getByRole('region', { name: /질문·경험/ });
  await section.getByRole('button', { name: /^질문·경험/ }).click();
  await section.getByRole('button', { name: '후기 남기기' }).first().click();
  const form = section.getByRole('form', { name: '후기 남기기' });
  await form.getByRole('radio', { name: '업무 만족 4점' }).click();
  await form.getByRole('button', { name: /더 남기기/ }).click();
  await form.getByRole('textbox').fill('아주 긴 후기예요. '.repeat(30));
  await form.getByRole('button', { name: '후기 남기기' }).click();
  const more = section.getByRole('button', { name: '더 보기' });
  await expect(more).toBeVisible();
  await more.click();
  await expect(section.getByRole('button', { name: '접기' })).toBeVisible();
});

test('click budget: review is 4 clicks with no typing, question is 3 clicks plus typing', async ({ page }) => {
  await setup(page);
  const section = page.getByRole('region', { name: /질문·경험/ });
  let clicks = 0;
  const click = async (locator: ReturnType<typeof section.locator>) => { await locator.click(); clicks += 1; };
  await click(section.getByRole('button', { name: /^질문·경험/ }));                                  // 1 펼치기
  await click(section.getByRole('button', { name: '후기 남기기' }).first());                          // 2
  const form = section.getByRole('form', { name: '후기 남기기' });
  await click(form.getByRole('radio', { name: '업무 만족 4점' }));                                    // 3 별점
  await click(form.getByRole('button', { name: '후기 남기기' }));                                     // 4 남기기
  await expect(section.getByText('후기 1개')).toBeVisible();
  expect(clicks).toBeLessThanOrEqual(4);

  clicks = 0;   // 질문: 이미 펼친 구역에서 질문하기 1 -> 입력 -> 보내기 1 (펼치기까지 3번)
  await click(section.getByRole('button', { name: '질문하기' }));
  await section.getByRole('textbox', { name: '질문하기' }).fill('서류는 언제까지 내나요?');
  await click(section.getByRole('button', { name: '질문하기' }).last());
  await expect(section.getByText('서류는 언제까지 내나요?')).toBeVisible();
  expect(clicks + 1).toBeLessThanOrEqual(3);
});
