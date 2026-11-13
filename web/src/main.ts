import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles.css';
import './notice-app';
import { registerSW } from 'virtual:pwa-register';
import { startScrollMemory } from './scroll-memory';
import { markUpdateReady, safeToSwapSilently } from './app-update';

const root = document.getElementById('app');
if (!root) throw new Error('Application root is missing');
root.append(document.createElement('notice-app'));

startScrollMemory();

// 처음 열고 아무것도 만지지 않은 동안만 새 버전을 조용히 바꾼다. 그 뒤에는 알림 줄로 묻고, 사용자가 누를 때만 바꾼다.
let interacted = false;
for (const type of ['pointerdown', 'keydown', 'input', 'wheel', 'touchstart']) window.addEventListener(type, () => { interacted = true; }, { once: true, capture: true, passive: true });

// 기다리던 새 서비스 워커를 켜고 다시 연다. 플러그인은 제어가 바뀔 때(controlling)만 다시 여는데, 처음 방문했거나
// 강력 새로고침으로 연 페이지는 서비스 워커의 제어를 받지 않아 그 이벤트가 오지 않는다. 그래서 눌러도 아무 일이 없었다(2026-11-13 재현).
// 새 워커가 켜지거나 제어가 바뀌면 바로, 둘 다 오지 않아도 4초 뒤에는 다시 연다.
async function swapNow(): Promise<void> {
  let done = false;
  const reload = () => { if (!done) { done = true; window.location.reload(); } };
  const registration = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  const waiting = registration?.waiting;
  if (!waiting) { reload(); return; }
  navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
  waiting.addEventListener('statechange', () => { if (waiting.state === 'activated') reload(); });
  window.setTimeout(reload, 4000);
  await updateSW(true);
}

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    if (safeToSwapSilently(performance.now(), interacted)) void swapNow();
    else markUpdateReady(() => { void swapNow(); });
  },
  // 새 배포를 열자마자 한 번, 그 뒤로는 화면에 돌아올 때와 한 시간마다 새 버전을 확인한다(찾으면 바꿔 끼우고 다시 연다).
  // 열 때 확인하지 않으면 배포 직후 첫 방문은 이전 화면에 머문다(실제로 확인함). 맨 처음에 하면 아직 아무것도 입력하기 전이라 다시 열어도 잃는 것이 없다.
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    let last = Date.now();
    void registration.update().catch(() => { /* 오프라인이면 다음에 다시 본다 */ });
    const check = () => {
      if (Date.now() - last < 60_000) return;
      last = Date.now();
      void registration.update().catch(() => { /* 오프라인이면 다음에 다시 본다 */ });
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    window.setInterval(check, 60 * 60_000);
  },
});

// 새 배포로 예전 조각 파일이 사라져 미리 불러오기가 실패하면 앱이 멈추지 않게 알림 줄로 다시 열기를 권한다.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  markUpdateReady(() => { window.location.reload(); });
});
