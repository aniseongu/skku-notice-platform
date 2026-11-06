import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles.css';
import './notice-app';
import { registerSW } from 'virtual:pwa-register';

// 새 화면 코드가 배포되면 조용히 바꿔 끼운다(docs/design/platforms.md 오프라인과 갱신).
registerSW({ immediate: true });
