// Playwright browser_run_code_unsafe로 실행. 격리된 브라우저에서만 읽음 상태를 바꾼다.
async (page) => {
  const origin = page.url().startsWith('http://127.0.0.1:5173')
    ? 'http://127.0.0.1:5173/?api=sample/api/v1' : 'https://aniseongu.github.io/skku-notice-alert/';
  const results = [];
  for (const width of [320, 412, 1280]) {
    const context = await page.context().browser().newContext({ viewport: { width, height: 891 }, serviceWorkers: 'block' });
    try {
      const p = await context.newPage();
      await p.goto(origin);
      await p.locator('.row').first().waitFor();
      await p.evaluate(async () => {
        const a = document.querySelector('notice-app'), n = a.notices[0];
        a.sources = [{ id: 'one', name: '학교', url: 'https://example.com' },
          { id: 'two', name: '다른 학교', url: 'https://example.com' },
          { id: 'jobs', name: '인턴', url: 'https://example.com', external: true }];
        a.notices = [{ ...n, id: 'one/1', source_id: 'one', title: '인턴 A', deadline: null },
          { ...n, id: 'one/2', source_id: 'one', title: '인턴 B', deadline: null },
          { ...n, id: 'two/3', source_id: 'two', title: '인턴 C', deadline: null },
          { ...n, id: 'jobs/4', source_id: 'jobs', title: '인턴 D', deadline: null }];
        a.readState = { v: 2, entries: { 'one/2': 0 } }; a.read = ['one/2']; a.keywords = ['인턴']; a.keyword = '인턴'; a.board = 'one';
        a.view = 'all'; a.matched = null; a.unreadOnly = false; a.syncCalls = 0;
        a.pushRead = () => { a.syncCalls++; };
        await a.updateComplete;
      });
      if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('가로 넘침');
      if (await p.getByRole('button', { name: '모두 읽음', exact: true }).count()) throw Error('중복 읽음 버튼');
      await p.evaluate(async () => {
        const a = document.querySelector('notice-app'); a.readState = { v: 2, entries: {} }; a.read = []; a.syncCalls = 0; await a.updateComplete;
      });
      await p.getByRole('button', { name: '선택', exact: true }).click();
      await p.getByRole('checkbox', { name: '인턴 A 선택' }).check();
      const partial = await p.getByRole('checkbox', { name: '전체 선택' }).evaluate(e => e.indeterminate);
      if (!partial) throw Error('부분 선택 상태가 표시되지 않음');
      await p.getByRole('button', { name: '선택한 읽지 않은 공지 1개 읽음으로 표시' }).click();
      let read = await p.evaluate(() => document.querySelector('notice-app').read);
      if (await p.evaluate(() => document.querySelector('notice-app').syncCalls) !== 1) throw Error('동기화 횟수 오류');
      if (!read.includes('one/1') || read.includes('one/2') || read.includes('two/3')) {
        throw Error('선택한 공지 외의 읽음 상태가 바뀜');
      }
      await p.getByRole('button', { name: '선택', exact: true }).click();
      await p.getByRole('checkbox', { name: '전체 선택' }).check();
      await p.getByRole('button', { name: '선택한 읽지 않은 공지 1개 읽음으로 표시' }).click();
      read = await p.evaluate(() => document.querySelector('notice-app').read);
      if (!read.includes('one/2') || read.includes('two/3') || read.includes('jobs/4')) {
        throw Error('전체 선택 범위 오류');
      }
      await p.getByRole('button', { name: '선택', exact: true }).click();
      await p.getByRole('checkbox', { name: '인턴 A 선택' }).check();
      await p.getByRole('button', { name: '선택한 읽은 공지 1개 읽지 않음으로 표시' }).click();
      read = await p.evaluate(() => document.querySelector('notice-app').read);
      if (read.includes('one/1') || !read.includes('one/2')) throw Error('선택한 공지 읽지 않음 오류');
      await p.getByRole('button', { name: '선택', exact: true }).click();
      await p.getByRole('checkbox', { name: '인턴 A 선택' }).check();
      await p.locator('.search input:visible').fill('B');
      if (await p.getByRole('checkbox', { name: '인턴 B 선택' }).isChecked()) throw Error('검색 뒤 선택이 남음');
      const count = await p.evaluate(() => document.querySelector('notice-app').selectedReads.length);
      if (count !== 0) throw Error('숨은 공지가 선택에 남음');
      await p.getByRole('button', { name: '닫기', exact: true }).click();
      if (await p.locator('.selection-check').count()) throw Error('선택 모드 종료 오류');
      await p.getByRole('button', { name: '선택', exact: true }).focus();
      await p.keyboard.press('Enter');
      if (!await p.getByRole('checkbox', { name: '전체 선택' }).evaluate(e => e === document.activeElement)) throw Error('선택 모드 포커스 오류');
      await p.keyboard.press('Escape');
      if (!await p.getByRole('button', { name: '선택', exact: true }).evaluate(e => e === document.activeElement)) throw Error('선택 종료 포커스 오류');
      results.push({ width, passed: true });
    } finally { await context.close(); }
  }
  return results;
}
