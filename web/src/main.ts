import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles.css';
import './notice-app';
import { registerSW } from 'virtual:pwa-register';

const root = document.getElementById('app');
if (!root) throw new Error('Application root is missing');
root.append(document.createElement('notice-app'));

registerSW({
  immediate: true,
  // 켜 둔 앱은 새 배포를 모른다. 화면에 돌아올 때와 한 시간마다 새 버전을 확인한다(찾으면 바꿔 끼우고 다시 연다).
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    let last = Date.now();
    const check = () => {
      if (Date.now() - last < 60_000) return;
      last = Date.now();
      void registration.update().catch(() => { /* 오프라인이면 다음에 다시 본다 */ });
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    window.setInterval(check, 60 * 60_000);
  },
});
