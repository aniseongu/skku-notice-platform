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
      editQuestion: async (id: string, body: string) => { const q = db.questions.find((item) => item.id === id); if (q) q.body = body; },
      editExperience: async (id: string, input: any) => { const r = db.reviews.find((item) => item.id === id); if (r) Object.assign(r, input); },
      deletePost: async (id: string) => { db.questions = db.questions.filter((q) => q.id !== id); db.reviews = db.reviews.filter((r) => r.id !== id); },
      report: async (id: string) => { db.reports.push(id); }, blockAuthor: async () => 'b',
    };
    app.profileStatus = 'unavailable'; app.authUserId = 'account-a'; app.onboardingDismissed = true;
    app.subscriptions = app.sources.map((s: { id: string }) => s.id); app.subscriptionsLoading = false;
  }, otherQuestion);
  await page.waitForTimeout(600);
}

test('authors can edit their review, question and answer in place', async ({ page }) => {
  await setup(page);
  const section = page.getByRole('region', { name: /질문·후기/ });
  await section.getByRole('button', { name: /^질문·후기/ }).click();
  await section.getByRole('button', { name: '후기 남기기' }).first().click();
  const reviewForm = section.getByRole('form', { name: '후기 남기기' });
  await reviewForm.getByRole('radio', { name: '업무 만족 4점' }).click();
  await reviewForm.getByRole('button', { name: '후기 남기기' }).click();
  const review = section.getByRole('listitem').filter({ hasText: '내 후기' });
  await review.getByRole('button', { name: '더 보기 메뉴' }).click();
  await review.getByRole('button', { name: '수정하기' }).click();
  const editReview = section.getByRole('form', { name: '후기 수정' });
  await expect(editReview.getByRole('radio', { name: '업무 만족 4점' })).toHaveAttribute('aria-checked', 'true');
  await editReview.getByRole('radio', { name: '업무 만족 5점' }).click();
  await editReview.getByRole('button', { name: '수정 완료' }).click();
  await expect(section.getByText('5.0').first()).toBeVisible();
  await section.getByRole('button', { name: '질문하기' }).click();
  await section.getByRole('textbox', { name: '질문하기' }).fill('원래 질문');
  await section.getByRole('form', { name: '질문하기' }).getByRole('button', { name: '질문하기' }).click();
  const question = section.getByRole('listitem').filter({ hasText: '원래 질문' });
  await question.getByRole('button', { name: '더 보기 메뉴' }).first().click();
  await question.getByRole('button', { name: '수정하기' }).click();
  await expect(section.getByRole('button', { name: '답하기' })).toHaveCount(0);
  await expect(section.getByRole('button', { name: '질문하기' })).toHaveCount(0);
  await expect(section.getByRole('form', { name: '질문 수정' }).getByRole('button', { name: '취소' })).toBeVisible();
  await question.getByRole('textbox', { name: '질문 수정' }).fill('고친 질문');
  await section.getByRole('form', { name: '질문 수정' }).getByRole('button', { name: '수정 완료' }).click();
  await expect(section.getByText('고친 질문')).toBeVisible();
  const updatedQuestion = section.getByRole('listitem').filter({ hasText: '고친 질문' });
  await updatedQuestion.getByRole('button', { name: '답하기' }).click();
  await updatedQuestion.getByRole('textbox', { name: '답 남기기' }).fill('원래 답');
  await updatedQuestion.getByRole('form', { name: '답 남기기' }).getByRole('button', { name: '답 남기기' }).click();
  const reply = section.getByRole('listitem').filter({ hasText: '원래 답' }).last();
  await reply.getByRole('button', { name: '더 보기 메뉴' }).click();
  await reply.getByRole('button', { name: '수정하기' }).click();
  await reply.getByRole('textbox', { name: '답 수정' }).fill('고친 답');
  await section.getByRole('form', { name: '답 수정' }).getByRole('button', { name: '수정 완료' }).click();
  await expect(section.getByText('고친 답')).toBeVisible();
});

test('blocked authors can be listed and unblocked from settings', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const app = (document.querySelector('notice-app') as unknown as App).controller;
    let blocked = [{ id: 'block-one', createdAt: '2026-11-20T03:00:00Z' }];
    app.qeApiOverride.listBlocks = async () => blocked;
    app.qeApiOverride.unblock = async (id: string) => { blocked = blocked.filter((item) => item.id !== id); };
    app.openSettings('blocks');
  });
  await expect(page).toHaveURL(/section=blocks/);
  const pageBody = page.locator('platform-settings-screen');
  await expect(pageBody.getByText('차단한 작성자 1')).toBeVisible();
  await expect(pageBody.getByText('2026년 11월 20일')).toBeVisible();
  // 공통 Setting 배치 그대로: 1280px 미만은 날짜 아래 왼쪽, 1280px 이상은 같은 줄 오른쪽 끝.
  const unblock = pageBody.getByRole('button', { name: '차단 해제: 차단한 작성자 1' });
  const nameBox = (await pageBody.getByText('차단한 작성자 1', { exact: true }).boundingBox())!;
  const dateBox = (await pageBody.getByText('2026년 11월 20일').boundingBox())!;
  const buttonBox = (await unblock.boundingBox())!;
  if ((page.viewportSize()?.width ?? 0) >= 1280) {
    expect(buttonBox.x).toBeGreaterThan(dateBox.x + dateBox.width);
    expect(buttonBox.y).toBeLessThan(dateBox.y + dateBox.height);
  } else {
    expect(buttonBox.y).toBeGreaterThanOrEqual(dateBox.y + dateBox.height);
    expect(Math.abs(buttonBox.x - nameBox.x)).toBeLessThanOrEqual(1);
  }
  await unblock.click();
  await expect(pageBody.getByText('차단한 작성자가 없어요')).toBeVisible();
  await expect(pageBody.getByText('차단을 해제하면 이 작성자의 글이 다시 보여요')).toHaveCount(0);
});

test('reopening settings waits for an in-flight unblock', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const app = (document.querySelector('notice-app') as unknown as App).controller;
    let blocked = [{ id: 'block-one', createdAt: '2026-11-20T03:00:00Z' }];
    app.qeApiOverride.listBlocks = async () => blocked;
    app.qeApiOverride.unblock = () => new Promise<void>((resolve) => {
      app.finishUnblock = () => { blocked = []; resolve(); };
    });
    app.openSettingsHome();
  });
  const settings = page.locator('platform-settings-screen');
  const manageLink = settings.getByRole('link', { name: /차단 관리/ });
  await manageLink.click();
  await settings.getByRole('button', { name: '차단 해제' }).click();
  await page.getByRole('button', { name: '설정으로 돌아가기' }).click();
  await manageLink.click();
  await expect(settings.getByText('불러오고 있어요')).toBeVisible();
  await page.evaluate(() => (document.querySelector('notice-app') as unknown as App).controller.finishUnblock());
  await expect(settings.getByText('차단한 작성자가 없어요')).toBeVisible();
});

test('a failed edit preserves the input and can be retried', async ({ page }) => {
  await setup(page);
  const section = page.getByRole('region', { name: /질문·후기/ });
  await section.getByRole('button', { name: /^질문·후기/ }).click();
  await section.getByRole('button', { name: '질문하기' }).click();
  await section.getByRole('textbox', { name: '질문하기' }).fill('원래 질문');
  await section.getByRole('form', { name: '질문하기' }).getByRole('button', { name: '질문하기' }).click();
  await expect(section.getByText('원래 질문')).toBeVisible();
  await page.evaluate(() => {
    const app = (document.querySelector('notice-app') as unknown as App).controller;
    const db = (window as unknown as { qdb: { questions: { id: string; body: string }[] } }).qdb;
    const listQuestions = app.qeApiOverride.listQuestions;
    let failed = false;
    app.qeApiOverride.listQuestions = () => failed ? Promise.reject(new Error('read failed')) : listQuestions();
    app.qeApiOverride.editQuestion = (_id: string, body: string) => {
      if (failed) {
        db.questions[0].body = body;
        failed = false;
        return Promise.resolve();
      }
      return new Promise<void>((_resolve, reject) => {
        app.failEdit = () => { failed = true; reject(new Error('write failed')); };
      });
    };
  });
  await section.getByRole('button', { name: '더 보기 메뉴' }).click();
  await section.getByRole('button', { name: '수정하기' }).click();
  const input = section.getByRole('textbox', { name: '질문 수정' });
  const submit = section.getByRole('button', { name: '수정 완료' });
  await input.fill('입력한 수정 내용');
  await submit.click();
  await expect(input).toBeDisabled();
  await page.evaluate(() => (document.querySelector('notice-app') as unknown as App).controller.failEdit());
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue('입력한 수정 내용');
  await submit.click();
  await expect(section.getByText('입력한 수정 내용', { exact: true })).toBeVisible();
});

test('a late block list from the previous account is discarded', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const app = (document.querySelector('notice-app') as unknown as App).controller;
    app.qeApiOverride.listBlocks = async ({ signal }: { signal: AbortSignal }) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      if (signal.aborted) throw new Error('account changed');
      return [{ id: 'old', createdAt: '2026-11-20T03:00:00Z' }];
    };
    app.openSettings('blocks');
  });
  await expect(page.locator('platform-settings-screen').getByText('불러오고 있어요')).toBeVisible();
  await page.evaluate(() => {
    const app = (document.querySelector('notice-app') as unknown as App).controller;
    app.advanceAccountEpoch(); app.authUserId = 'account-b';
    app.qeApiOverride.listBlocks = async () => [];
    app.requestUpdate();
  });
  await expect(page.locator('platform-settings-screen').getByText('차단한 작성자가 없어요')).toBeVisible();
  await page.waitForTimeout(900);
  await expect(page.locator('platform-settings-screen').getByText('차단한 작성자 1')).toHaveCount(0);
});

test('empty state, leave a star-only review, ask a question and answer it', async ({ page }) => {
  await setup(page);
  await expect(page.locator('section.qe')).toHaveCount(1);   // 상세에는 구역이 하나만 그려진다
  const section = page.getByRole('region', { name: /질문·후기/ });
  const head = section.getByRole('button', { name: /^질문·후기/ });
  await expect(head).toHaveAttribute('aria-expanded', 'false');   // 기본은 접힌 한 줄
  await expect(head).toHaveText('질문·후기');
  expect((await head.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await head.click();
  await expect(section.getByText('아직 글이 없어요')).toBeVisible();   // 빈 방처럼 보이지 않게 안내
  await expect(section.getByText(/이름은 보이지 않아요/)).toHaveCount(0);   // 안내는 글 쓰는 칸 아래에만
  const buttons = section.getByRole('button', { name: /^(질문하기|후기 남기기)$/ });
  await expect(buttons).toHaveText(['질문하기', '후기 남기기']);
  expect((await buttons.nth(0).boundingBox())!.height).toBe((await buttons.nth(1).boundingBox())!.height);
  await buttons.nth(0).click();   // 1번으로 폼이 열린다
  const askForm = section.getByRole('form', { name: '질문하기' });
  await expect(askForm.getByText(/이름은 보이지 않아요/)).toBeVisible();
  await askForm.getByRole('button', { name: '닫기' }).click();
  await expect(askForm).toHaveCount(0);
  await expect(section.getByText('아직 글이 없어요')).toBeVisible();
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
  await expect(head).toHaveAccessibleName('질문·후기 후기 1');
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
  await expect(head).toHaveAccessibleName('질문·후기 후기 1 · 질문 1');
  await head.click();
  await review.getByRole('button', { name: '더 보기 메뉴' }).click();
  await review.getByRole('button', { name: '지우기' }).click();
  await expect(review.getByText('이 후기를 지울까요?')).toBeVisible();
  await review.getByRole('group', { name: '지우기' }).getByRole('button', { name: '지우기' }).click();
  await expect(review).toHaveCount(0);
});

test('click budget: report takes three clicks from the card menu through confirmation', async ({ page }) => {
  await setup(page, true);
  const head = page.getByRole('button', { name: '질문·후기 질문 1' });
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
  const section = page.getByRole('region', { name: /질문·후기/ });
  await section.getByRole('button', { name: /^질문·후기/ }).click();
  await section.getByRole('button', { name: '후기 남기기' }).first().click();
  const form = section.getByRole('form', { name: '후기 남기기' });
  await form.getByRole('radio', { name: '업무 만족 5점' }).click();
  await form.getByRole('button', { name: '닫기' }).click();
  await section.getByRole('button', { name: '후기 남기기' }).first().click();
  await expect(section.getByRole('form', { name: '후기 남기기' }).getByRole('radio', { name: '업무 만족 5점' })).toHaveAttribute('aria-checked', 'true');
});

test('"더 보기" only appears on long review bodies; star-only review has one submit button', async ({ page }) => {
  await setup(page);
  const section = page.getByRole('region', { name: /질문·후기/ });
  await section.getByRole('button', { name: /^질문·후기/ }).click();
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
  const section = page.getByRole('region', { name: /질문·후기/ });
  await section.getByRole('button', { name: /^질문·후기/ }).click();
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
  const section = page.getByRole('region', { name: /질문·후기/ });
  let clicks = 0;
  const click = async (locator: ReturnType<typeof section.locator>) => { await locator.click(); clicks += 1; };
  await click(section.getByRole('button', { name: /^질문·후기/ }));                                  // 1 펼치기
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
  const section = page.getByRole('region', { name: /질문·후기/ });
  await section.getByRole('button', { name: /^질문·후기/ }).click();
  await section.getByRole('button', { name: '질문하기' }).click();
  await section.getByRole('textbox', { name: '질문하기' }).fill('계정 A의 글');
  const result = await page.evaluate(async () => {
    const controller = (document.querySelector('notice-app') as unknown as App).controller;
    const id = controller.openedId ?? controller.selectedId;
    const old = controller.questionsModel({ id });
    let calls = 0;
    const mutate = async () => { calls++; return 'new-id'; };
    Object.assign(controller.qeApiOverride, { createQuestion: mutate, createExperience: mutate, editQuestion: mutate, editExperience: mutate, deletePost: mutate, report: mutate, blockAuthor: mutate, unblock: mutate });
    const oldBlocks = controller.questionBlocksModel();
    const writes = () => Promise.all([old.ask('질문'), old.review({ satisfaction: 5 }), old.editQuestion('p', '수정'), old.editReview('p', { satisfaction: 4 }), old.remove('p'), old.report('p'), old.block('p'), oldBlocks.unblock('b')]);
    controller.subscriptionsEpoch++;
    const changedEpoch = await writes();
    controller.subscriptionsEpoch--;
    controller.authUserId = 'account-b';
    const changedUser = await writes();
    return { calls, changedEpoch, changedUser };
  });
  expect(result).toEqual({ calls: 0, changedEpoch: Array(8).fill(false), changedUser: Array(8).fill(false) });
  await expect(section.getByRole('button', { name: /^질문·후기/ })).toHaveAttribute('aria-expanded', 'false');
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
  await page.getByRole('button', { name: /^질문·후기/ }).click();
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
  await page.getByRole('button', { name: /^질문·후기/ }).click();
  await page.evaluate(() => {
    const controller = (document.querySelector('notice-app') as unknown as App).controller;
    const id = controller.openedId ?? controller.selectedId;
    (window as unknown as { qdb: { questions: unknown[] } }).qdb.questions.push({ id: 'detached', body: '남아 있는 답변', detached: true });
    controller.questionsModel({ id }).load();
  });
  const section = page.getByRole('region', { name: /질문·후기/ });
  const replies = section.getByRole('list', { name: '답변' });
  await expect(replies).toContainText('남아 있는 답변');
  await expect(replies.locator('xpath=preceding-sibling::p')).toHaveText('원래 질문을 볼 수 없어요');
  await expect(section.getByRole('button', { name: '답하기' })).toHaveCount(0);
});
