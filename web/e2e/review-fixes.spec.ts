import { test, expect } from '@playwright/test';

// 반대 리뷰(fe45876..f7d742e) 지적 재현·고침 시험. 실제 브라우저 IndexedDB를 쓴다.
test('a late stale detail cache write from another tab cannot overwrite a newer memo or revive a deleted one', async ({ page }) => {
  await page.goto('/?api=sample/api/v1');
  const result = await page.evaluate(async () => {
    const { saveDetailField, loadDetailCache, clearDetailCache } = await import('/src/detail-cache.ts');
    const live = () => true;
    const row = (note: string, updated_at: string) => ({ notice_id: 'n1', title: 't', url: null, board: null, deadline: null, status: 'interested', note, created_at: '', updated_at });
    const newer = Date.parse('2026-11-23T10:00:00Z'), older = Date.parse('2026-11-23T09:00:00Z');
    await clearDetailCache('u1');
    await saveDetailField('u1', 'n1', 'opportunity', row('새 메모', '2026-11-23T10:00:00Z') as never, live, newer);
    await saveDetailField('u1', 'n1', 'opportunity', row('옛 메모', '2026-11-23T09:00:00Z') as never, live, older);   // 다른 탭의 늦은 옛 조회
    const afterStale = (await loadDetailCache('u1', 'n1')).opportunity?.note ?? null;
    await saveDetailField('u1', 'n1', 'opportunity', null, live, Date.parse('2026-11-23T11:00:00Z'));       // 삭제
    await saveDetailField('u1', 'n1', 'opportunity', row('되살아난 메모', '2026-11-23T10:00:00Z') as never, live, newer);   // 늦은 옛 조회가 삭제 뒤 도착
    const afterDelete = (await loadDetailCache('u1', 'n1')).opportunity ?? null;
    return { afterStale, afterDelete };
  });
  expect(result).toEqual({ afterStale: '새 메모', afterDelete: null });
});
