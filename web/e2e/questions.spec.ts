import { test, expect, type Page } from '@playwright/test';

type App = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// 서버 없이 컨트롤러와 화면의 실제 연결을 본다. 서버 대신 메모리 가짜를 끼운다.
async function setup(page: Page, otherQuestion = false) {
  await page.goto('/?api=sample/api/v1');
  await page.locator('notice-rows-screen a.row').first().waitFor();
  await page.waitForLoadState('networkidle');
  await page.locator('notice-rows-screen a.row').first().click();
  await page.evaluate((otherQuestion) => {
    const app = document.querySelector('notice-app') as unknown as App;
    const db = { questions: [] as any[], reviews: [] as any[], reports: [] as string[] };
    if (otherQuestion) db.questions.push({ id: 'other', body: '면접은 언제인가요?', mine: false });
    (window as unknown as { qdb: typeof db }).qdb = db;
    const summary = (key: string) => { const v = db.reviews.map((r) => r[key]).filter(Boolean); return { average: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, count: v.length }; };
    app.controller.qeApiOverride = {
      listQuestions: async () => db.questions.map((q) => ({ id: q.id, parentId: q.parentId ?? null, body: q.body, anonNo: 1, createdAt: '', mine: q.mine ?? true, hidden: false, detached: !!q.detached })),
      listExperiences: async () => ({ posts: db.reviews.map((r) => ({ id: r.id, body: r.body ?? null, satisfaction: r.satisfaction, learning: r.learning ?? null, difficulty: null, participated: !!r.participated, mine: true, hidden: false })),
        count: db.reviews.length, satisfaction: summary('satisfaction'), learning: summary('learning'), difficulty: summary('difficulty') }),
      createQuestion: async (_n: string, body: string, parentId?: string) => { db.questions.push({ id: `q${db.questions.length + 1}`, body, parentId }); return 'x'; },
      createExperience: async (_n: string, input: any) => { db.reviews.push({ id: `r${db.reviews.length + 1}`, ...input }); return 'x'; },
      deletePost: async (id: string) => { db.questions = db.questions.filter((q) => q.id !== id); db.reviews = db.reviews.filter((r) => r.id !== id); },
      report: async (id: string) => { db.reports.push(id); }, blockAuthor: async () => 'b',
    };
    app.profileStatus = 'unavailable'; app.authUserId = 'account-a'; app.onboardingDismissed = true;
    app.subscriptions = app.sources.map((s: { id: string }) => s.id); app.subscriptionsLoading = false;
  }, otherQuestion);
  await page.waitForTimeout(600);
}

test('empty state, leave a star-only review, ask a question and answer it', async ({ page }) => {
  await setup(page);
  await expect(page.locator('section.qe')).toHaveCount(1);   // 상세에는 구역이 하나만 그려진다
  const section = page.getByRole('region', { name: /질문·경험/ });
  const head = section.getByRole('button', { name: /^질문·경험/ });
  await expect(head).toHaveAttribute('aria-expanded', 'false');   // 기본은 접힌 한 줄
  await expect(head).toHaveText('질문·경험');
  expect((await head.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await head.click();
  await expect(section.getByText(/아직 남은 글이 없어요/)).toBeVisible();   // 빈 방처럼 보이지 않게 안내
  await section.getByRole('button', { name: '후기 남기기' }).first().click();
  const form = section.getByRole('form', { name: '후기 남기기' });
  await expect(section.getByText(/이름은 보이지 않아요/)).toHaveCount(1);
  await expect(form.getByText(/이름은 보이지 않아요/)).toBeVisible();
  await expect(form.getByRole('button', { name: '후기 남기기' })).toBeDisabled();   // 별점이 필요하다
  await form.getByRole('radio', { name: '업무 만족 4점' }).click();
  await form.getByRole('button', { name: '후기 남기기' }).click();   // 별점만으로 끝: 클릭 2번
  await expect(section.getByText('후기 1개')).toBeVisible();
  await expect(section.getByText('4.0').first()).toBeVisible();
  await expect(section.getByText('내 후기')).toBeVisible();
  const review = section.getByRole('listitem').filter({ hasText: '내 후기' });
  expect((await review.boundingBox())!.height).toBeLessThan(70);
  await head.click();
  await expect(head).toHaveAccessibleName('질문·경험 후기 1');
  await head.click();
  await expect(section.getByRole('button', { name: '후기 남기기' })).toHaveCount(0);   // 이미 남겼다

  await section.getByRole('button', { name: '질문하기' }).click();
  await section.getByRole('textbox', { name: '질문하기' }).fill('서류는 언제까지 내나요?');
  await section.getByRole('button', { name: '질문하기' }).last().click();
  await expect(section.getByText('서류는 언제까지 내나요?')).toBeVisible();
  await section.getByRole('button', { name: '답하기' }).click();
  await section.getByRole('textbox', { name: '답 남기기' }).fill('금요일까지예요');
  await section.getByRole('button', { name: '답 남기기' }).last().click();
  await expect(section.getByText('금요일까지예요')).toBeVisible();
  await head.click();
  await expect(head).toHaveAccessibleName('질문·경험 후기 1 · 질문 1');
  await head.click();
  await review.getByRole('button', { name: '더 보기 메뉴' }).click();
  await review.getByRole('button', { name: '지우기' }).click();
  await expect(review.getByText('이 후기를 지울까요?')).toBeVisible();
  await review.getByRole('group', { name: '지우기' }).getByRole('button', { name: '지우기' }).click();
  await expect(review).toHaveCount(0);
});

test('click budget: report takes three clicks from the card menu through confirmation', async ({ page }) => {
  await setup(page, true);
  const head = page.getByRole('button', { name: '질문·경험 질문 1' });
  await head.click();
  const card = page.getByRole('listitem').filter({ hasText: '면접은 언제인가요?' });
  const more = card.getByRole('button', { name: '더 보기 메뉴' });
  const box = (await more.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  const reports = () => page.evaluate(() => (window as unknown as { qdb: { reports: string[] } }).qdb.reports);
  await expect(card.getByRole('button', { name: '신고하기' })).toHaveCount(0);
  await more.click(); // 카드의 ⋯ 메뉴를 여는 클릭이 추가됐다.
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(card.getByRole('button', { name: '차단하기' })).toBeVisible();
  await card.getByRole('button', { name: '신고하기' }).click();
  const confirmation = card.getByRole('group', { name: '신고하기' });
  await expect(confirmation.getByText('이 질문을 신고할까요?')).toBeVisible();
  expect(await reports()).toEqual([]);
  await confirmation.getByRole('button', { name: '신고하기' }).click();
  await expect.poll(reports).toEqual(['other']);
  await expect(more).toHaveAttribute('aria-expanded', 'false');
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
  const more = form.getByRole('button', { name: '더 남기기 (선택)' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(form.getByRole('textbox')).toBeVisible();
  await expect(form.getByRole('button', { name: '후기 남기기' })).toHaveCount(1);   // 펼쳐도 하나
  await form.getByRole('radio', { name: '업무 만족 4점' }).click();
  await form.getByRole('textbox').fill('짧은 후기예요');
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(form.getByRole('textbox')).toBeHidden();
  await form.getByRole('button', { name: '후기 남기기' }).click();
  await expect(section.getByText('짧은 후기예요')).toBeVisible();
  await expect(section.getByRole('button', { name: '더 보기', exact: true })).toHaveCount(0);   // 짧은 글에는 없다
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
  const more = section.getByRole('button', { name: '더 보기', exact: true });
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

test('stale question models cannot mutate after an account or epoch change, and the form remounts', async ({ page }) => {
  await setup(page);
  const section = page.getByRole('region', { name: /질문·경험/ });
  await section.getByRole('button', { name: /^질문·경험/ }).click();
  await section.getByRole('button', { name: '질문하기' }).click();
  await section.getByRole('textbox', { name: '질문하기' }).fill('계정 A의 글');
  const result = await page.evaluate(async () => {
    const controller = (document.querySelector('notice-app') as unknown as App).controller;
    const id = controller.openedId ?? controller.selectedId;
    const old = controller.questionsModel({ id });
    let calls = 0;
    const mutate = async () => { calls++; return 'new-id'; };
    Object.assign(controller.qeApiOverride, { createQuestion: mutate, createExperience: mutate, deletePost: mutate, report: mutate, blockAuthor: mutate });
    const writes = () => Promise.all([old.ask('질문'), old.review({ satisfaction: 5 }), old.remove('p'), old.report('p'), old.block('p')]);
    controller.subscriptionsEpoch++;
    const changedEpoch = await writes();
    controller.subscriptionsEpoch--;
    controller.authUserId = 'account-b';
    const changedUser = await writes();
    return { calls, changedEpoch, changedUser };
  });
  expect(result).toEqual({ calls: 0, changedEpoch: Array(5).fill(false), changedUser: Array(5).fill(false) });
  await expect(section.getByRole('button', { name: /^질문·경험/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(section.getByRole('textbox')).toHaveCount(0);
});

test('the shared account epoch reset clears an in-flight question write and discards its completion', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const controller = (document.querySelector('notice-app') as unknown as App).controller;
    const id = controller.openedId ?? controller.selectedId;
    let finish!: (id: string) => void;
    const response = new Promise<string>((resolve) => { finish = resolve; });
    let signal: AbortSignal | undefined;
    controller.qeApiOverride.createQuestion = (_id: string, _body: string, _parent: string | undefined, guard: { signal: AbortSignal }) => {
      signal = guard.signal;
      return response;
    };
    const pending = controller.questionsModel({ id }).ask('질문');
    const busyBefore = controller.qeBusy;
    const epochBefore = controller.subscriptionsEpoch;
    controller.advanceAccountEpoch();
    const reset = [controller.subscriptionsEpoch - epochBefore, controller.qeBusy, controller.qeBusyCount, controller.qeState.noticeId, signal?.aborted];
    finish('new-id');
    return { busyBefore, reset, result: await pending, busyAfter: controller.qeBusy, countAfter: controller.qeBusyCount };
  });
  expect(result).toEqual({ busyBefore: true, reset: [1, false, 0, null, true], result: false, busyAfter: false, countAfter: 0 });
});

test('reading an existing review clears only its own draft', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: /^질문·경험/ }).click();
  const keys = await page.evaluate(() => {
    const controller = (document.querySelector('notice-app') as unknown as App).controller;
    const id = controller.openedId ?? controller.selectedId;
    const keys = [`qe-draft:account-a:${id}`, `qe-draft:account-b:${id}`, 'qe-draft:account-a:another-notice'];
    for (const key of keys) localStorage.setItem(key, JSON.stringify({ satisfaction: 3 }));
    (window as unknown as { qdb: { reviews: unknown[] } }).qdb.reviews.push({ id: 'r1', satisfaction: 4 });
    controller.questionsModel({ id }).load();
    return keys;
  });
  await expect(page.getByText('내 후기')).toBeVisible();
  expect(await page.evaluate((keys) => keys.map((key) => localStorage.getItem(key) !== null), keys)).toEqual([false, true, true]);
});

test('schema cache errors leave the feature available to retry on the next notice', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const controller = (document.querySelector('notice-app') as unknown as App).controller;
    const id = controller.openedId ?? controller.selectedId;
    let calls = 0;
    controller.qeApiOverride.listQuestions = async () => {
      if (++calls === 1) throw { code: 'PGRST202' };
      return [];
    };
    controller.loadQuestions(id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const failed = controller.qeState.status;
    const unavailable = controller.qeUnavailable;
    controller.loadQuestions('next-notice');
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { failed, unavailable, next: controller.qeState.status };
  });
  expect(result).toEqual({ failed: 'failed', unavailable: false, next: 'ready' });
});

test('a detached reply appears below the unavailable-question message and has no reply button', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: /^질문·경험/ }).click();
  await page.evaluate(() => {
    const controller = (document.querySelector('notice-app') as unknown as App).controller;
    const id = controller.openedId ?? controller.selectedId;
    (window as unknown as { qdb: { questions: unknown[] } }).qdb.questions.push({ id: 'detached', body: '남아 있는 답변', detached: true });
    controller.questionsModel({ id }).load();
  });
  const section = page.getByRole('region', { name: /질문·경험/ });
  const replies = section.getByRole('list', { name: '답변' });
  await expect(replies).toContainText('남아 있는 답변');
  await expect(replies.locator('xpath=preceding-sibling::p')).toHaveText('원래 질문을 볼 수 없어요');
  await expect(section.getByRole('button', { name: '답하기' })).toHaveCount(0);
});
