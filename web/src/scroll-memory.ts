// 새로고침 직전 화면을 그대로 되살린다. 목록과 상세 칸의 스크롤 위치를 이 탭에만 기억한다.
// 공지와 본문은 늦게 들어오므로, 칸이 그 위치까지 내려갈 수 있을 때까지 잠깐 다시 맞춘다.
const KEY = 'scroll';
const PANES = ['.list-pane', '.detail-pane'];
const LIMIT_MS = 4000;

function read(): Record<string, number> {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(Object.entries(value).filter(([key, top]) => PANES.includes(key) && typeof top === 'number' && top > 0));
  } catch { return {}; }
}

export function startScrollMemory(): void {
  const pending = read();
  try { sessionStorage.removeItem(KEY); } catch { /* 저장소를 못 쓰면 기억하지 않는다 */ }
  addEventListener('pagehide', () => {
    const saved: Record<string, number> = {};
    for (const selector of PANES) {
      const pane = document.querySelector(selector);
      if (pane && pane.scrollTop > 0) saved[selector] = pane.scrollTop;
    }
    try { sessionStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* 저장소를 못 쓰면 기억하지 않는다 */ }
  });
  if (!Object.keys(pending).length) return;
  // 사용자가 직접 움직이면 그 뜻을 따른다.
  let stopped = false;
  const stop = () => { stopped = true; };
  const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
  for (const type of events) addEventListener(type, stop, { capture: true, passive: true });
  const until = Date.now() + LIMIT_MS;
  const step = () => {
    for (const [selector, top] of Object.entries(pending)) {
      const pane = document.querySelector(selector);
      if (!pane) continue;
      pane.scrollTop = top;
      if (Math.abs(pane.scrollTop - top) < 2) delete pending[selector];
    }
    if (stopped || !Object.keys(pending).length || Date.now() > until) {
      for (const type of events) removeEventListener(type, stop, { capture: true });
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
