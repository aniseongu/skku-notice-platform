// 새로고침 직전 화면을 그대로 되살린다. 목록과 상세 칸의 스크롤 위치를 이 탭에만 기억한다.
// 공지와 본문은 늦게 들어오므로, 칸이 그 위치까지 내려갈 수 있을 때까지 잠깐 다시 맞춘다.
const KEY = 'scroll';
const PANES = ['.list-pane', '.detail-pane'];
// 휴대폰(720px 미만)에서는 칸이 아니라 창이 스크롤된다. 브라우저의 기본 복원은 목록이 비어 있을 때 일어나 맨 위로 남으므로 직접 되살린다.
const WINDOW = 'window';
const LIMIT_MS = 4000;

function read(): Record<string, number> {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(Object.entries(value).filter(([key, top]) => (PANES.includes(key) || key === WINDOW) && typeof top === 'number' && top > 0));
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
    if (scrollY > 0 && innerWidth < 720) saved[WINDOW] = scrollY;
    try { sessionStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* 저장소를 못 쓰면 기억하지 않는다 */ }
  });
  if (!Object.keys(pending).length) return;
  const nativeMode = 'scrollRestoration' in history ? history.scrollRestoration : null;
  if (WINDOW in pending && nativeMode) history.scrollRestoration = 'manual';
  // 사용자가 직접 움직이면 그 뜻을 따른다.
  let stopped = false;
  const stop = () => { stopped = true; };
  const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
  for (const type of events) addEventListener(type, stop, { capture: true, passive: true });
  const until = Date.now() + LIMIT_MS;
  const step = () => {
    for (const [selector, top] of Object.entries(pending)) {
      if (selector === WINDOW) {
        // 목록이 아직 없으면(문서가 짧으면) 기다린다. 목록이 그려진 같은 프레임에 한 번에 내려간다.
        if (!document.querySelector('a.row')) continue;
        scrollTo(0, top);
        if (Math.abs(scrollY - top) < 2) delete pending[selector];
        continue;
      }
      const pane = document.querySelector(selector);
      if (!pane) continue;
      pane.scrollTop = top;
      if (Math.abs(pane.scrollTop - top) < 2) delete pending[selector];
    }
    if (stopped || !Object.keys(pending).length || Date.now() > until) {
      if (nativeMode) history.scrollRestoration = nativeMode;
      for (const type of events) removeEventListener(type, stop, { capture: true });
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
