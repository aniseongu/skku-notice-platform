import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles.css';
import './notice-app';
import { registerSW } from 'virtual:pwa-register';
import { startScrollMemory } from './scroll-memory';

const root = document.getElementById('app');
if (!root) throw new Error('Application root is missing');
root.append(document.createElement('notice-app'));

startScrollMemory();

registerSW({
  immediate: true,
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
