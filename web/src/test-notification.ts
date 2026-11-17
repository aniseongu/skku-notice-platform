import { APP_NAME } from './brand.ts';

// 출처: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification
export async function showTestNotification(registration: ServiceWorkerRegistration, userAgent: string): Promise<string> {
  const tag = `skku-notice-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await registration.showNotification(APP_NAME, {
    body: '이렇게 알림이 와요',
    icon: new URL('icon-192.png', registration.scope).href,
    badge: new URL('icon-monochrome-512.png', registration.scope).href,
    tag,
    silent: false,
  });
  const notifications = await registration.getNotifications({ tag });
  if (!notifications.length) return '테스트 알림을 확인하지 못했어요. 휴대폰의 알림 설정을 확인해 주세요';
  return /SamsungBrowser/i.test(userAgent)
    ? "알림이 보이지 않으면 휴대폰 설정 > 애플리케이션 > 삼성 인터넷 > 알림에서 '웹사이트 알림'과 '팝업으로 표시'를 확인해 주세요"
    : '알림이 보이지 않으면 휴대폰 설정에서 브라우저 앱의 알림과 팝업 표시를 확인해 주세요';
}
