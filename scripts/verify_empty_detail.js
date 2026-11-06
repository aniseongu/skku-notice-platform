// Playwright browser_run_code_unsafe에서 예제 데이터로 실행한다.
async (page) => {
  const browser = page.context().browser();
  const results = [];
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme, serviceWorkers: 'block' });
    try {
      const p = await context.newPage();
      await p.goto('http://127.0.0.1:5173/?api=sample/api/v1');
      await p.locator('.row .title').first().waitFor();
      const nav = p.locator('.sidebar nav');
      const detail = p.locator('.detail-pane');
      await nav.getByRole('button', { name: /인턴 공고/ }).click();
      await nav.getByRole('button', { name: /저장/ }).click();
      if (await detail.isVisible()) throw Error('빈 저장 목록에 상세가 표시됨');
      await p.keyboard.press('Escape');
      await nav.getByRole('button', { name: /성대 공지/ }).click();
      if (!await detail.isVisible()) throw Error('빈 목록에서 돌아온 뒤 상세가 열리지 않음');
      const search = p.locator('.topbar input[type=search]');
      await search.fill('일치하지않는검색어xyz123');
      if (await detail.isVisible()) throw Error('검색 결과가 없는데 상세가 표시됨');
      await search.fill('');
      if (!await detail.isVisible()) throw Error('검색을 지운 뒤 상세가 열리지 않음');
      await p.getByRole('button', { name: '상세 칸 닫기' }).click();
      await nav.getByRole('button', { name: /저장/ }).click();
      if (await p.getByRole('button', { name: '상세 칸 열기' }).isVisible()) throw Error('빈 목록에 상세 열기가 표시됨');
      await nav.getByRole('button', { name: /성대 공지/ }).click();
      if (await detail.isVisible()) throw Error('수동으로 닫은 설정이 유지되지 않음');
      await p.getByRole('button', { name: '상세 칸 열기' }).click();
      if (!await detail.isVisible()) throw Error('상세를 다시 열 수 없음');
      results.push({ colorScheme, passed: true });
    } finally { await context.close(); }
  }
  return results;
}
