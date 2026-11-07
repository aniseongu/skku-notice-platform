import assert from 'node:assert/strict';
import test from 'node:test';
import { composeSummaryTime, loadDevices, loadSummaryTime, saveCanvasMode, saveDeviceName, saveSummaryTime, suggestDeviceName, summaryParts, validDeviceName } from '../src/devices.ts';

test('device names suggest the model when the browser tells it, otherwise a plain kind of device', async () => {
  const name = (ua) => suggestDeviceName(ua, false);
  assert.equal(await name('Mozilla/5.0 (Linux; Android 14; SM-S911N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Mobile Safari/537.36'), 'SM-S911N');
  assert.equal(await name('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Mobile Safari/537.36'), '안드로이드 휴대폰');
  assert.equal(await name('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36 Whale/4.35'), 'Windows PC');
  assert.equal(await name('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), 'iPhone');
  assert.equal(await name('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), 'iPad');
  assert.equal(await name('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'), 'Mac');
  assert.equal(await name('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'), 'PC');
  assert.equal(validDeviceName('내 노트북'), true);
  assert.equal(validDeviceName('   '), false);
  assert.equal(validDeviceName('가'.repeat(41)), false);
  assert.equal(validDeviceName('줄바꿈\n있음'), false);
});

test('summary time converts to the original AM/PM control and back', () => {
  assert.deepEqual(summaryParts('21:05'), { period: 'pm', hour: 9, minute: 5 });
  assert.deepEqual(summaryParts('00:30'), { period: 'am', hour: 12, minute: 30 });
  assert.deepEqual(summaryParts('12:00'), { period: 'pm', hour: 12, minute: 0 });
  assert.deepEqual(summaryParts('07:00'), { period: 'am', hour: 7, minute: 0 });
  for (const t of ['00:00', '00:30', '07:00', '11:59', '12:00', '12:30', '13:15', '21:05', '23:59']) {
    const p = summaryParts(t);
    assert.equal(composeSummaryTime(p.period, p.hour, p.minute), t, t);
  }
  assert.equal(composeSummaryTime('am', 0, 0), null);
  assert.equal(composeSummaryTime('pm', 13, 0), null);
  assert.equal(composeSummaryTime('pm', 9, 60), null);
  assert.equal(composeSummaryTime('pm', 1.5, 0), null);
});

function fake({ rows = [], updated = [{ user_id: 'u' }], error = null } = {}) {
  const calls = [];
  const chain = (table, op) => { const q = { table, op, eq: {} }; const c = {
    select: () => c, eq: (k, v) => { q.eq[k] = v; return c; }, order: () => c, update: (v) => { q.values = v; return c; },
    maybeSingle: async () => { calls.push(q); return { data: rows[0] ?? null, error }; },
    then: (resolve) => { calls.push(q); resolve({ data: q.op === 'update' ? updated : rows, error }); } }; return c; };
  return { calls, from: (table) => ({ select: (...a) => chain(table, 'select').select(...a), update: (v) => chain(table, 'update').update(v) }) };
}

test('devices and summary time are read and written only for my own rows', async () => {
  const c = fake({ rows: [{ id: 'd1', endpoint: 'https://fcm.googleapis.com/x', device_name: 'Windows · Whale', canvas_mode: 'summary', created_at: '2026-11-08T00:00:00Z' },
    { id: 'd2', endpoint: 'https://fcm.googleapis.com/y', device_name: null, canvas_mode: 'weird', created_at: 'x' }, { id: 5, endpoint: 'z' }] });
  const devices = await loadDevices(c, 'user-a');
  assert.deepEqual(devices.map((d) => [d.id, d.name, d.canvasMode]), [['d1', 'Windows · Whale', 'summary'], ['d2', null, 'reminders']]);
  assert.deepEqual(c.calls[0].eq, { user_id: 'user-a' });
  await saveCanvasMode(c, 'user-a', 'd1', 'off');
  const write = c.calls.at(-1);
  assert.deepEqual(write.values, { canvas_mode: 'off' });
  assert.deepEqual(write.eq, { id: 'd1', user_id: 'user-a' });
  assert.equal(await loadSummaryTime(fake({ rows: [{ summary_time: '21:05:00' }] }), 'u'), '21:05');
  assert.equal(await loadSummaryTime(fake({ rows: [] }), 'u'), null);
  await saveDeviceName(c, 'user-a', 'd1', ' 내 노트북 ');
  assert.deepEqual(c.calls.at(-1).values, { device_name: '내 노트북' });
  assert.deepEqual(c.calls.at(-1).eq, { id: 'd1', user_id: 'user-a' });
  await assert.rejects(saveDeviceName(c, 'user-a', 'd1', ''), /40자/);
  await saveSummaryTime(c, 'user-a', '07:30');
  assert.deepEqual(c.calls.at(-1).values, { summary_time: '07:30' });
  await assert.rejects(saveSummaryTime(c, 'user-a', '25:00'), /형식/);
  await assert.rejects(saveSummaryTime(fake({ updated: [] }), 'u', '07:30'), /토큰을 먼저/);
});
