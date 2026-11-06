// 출처: https://github.com/mdn/serviceworker-cookbook/tree/master/push-payload
// Workbox가 만든 워커에서 불러온다. 키와 구독 주소는 이 파일에 두지 않는다.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    const parsed = event.data ? event.data.json() : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed;
  } catch { /* 비어 있으면 앱으로 연다 */ }
  const title = typeof payload.title === 'string' ? payload.title : '성공';
  const body = typeof payload.body === 'string' ? payload.body : '새 공지가 도착했어요';
  let target = new URL('./', self.registration.scope);
  try {
    const candidate = new URL(payload.url);
    const internship = (candidate.hostname === 'linkareer.com' && /^\/activity\/\d+\/?$/.test(candidate.pathname))
      || (candidate.hostname === 'jasoseol.com' && /^\/recruit\/\d+\/?$/.test(candidate.pathname));
    if (candidate.protocol === 'https:' && !candidate.username && !candidate.password && !candidate.port
      && (candidate.origin === self.location.origin || candidate.hostname === 'skku.edu'
        || candidate.hostname.endsWith('.skku.edu') || internship)) target = candidate;
  } catch { /* 올바르지 않은 주소는 앱으로 연다 */ }
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: new URL('icon-192.png', self.registration.scope).href,
    badge: new URL('icon-monochrome-512.png', self.registration.scope).href,
    tag: typeof payload.tag === 'string' ? payload.tag : 'skku-notice',
    silent: payload.silent === true,
    data: { url: target.href },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // URL은 push 수신 때 검사한 값이다. 알림을 누르면 바로 원문을 연다.
  const target = event.notification.data?.url || self.registration.scope;
  event.waitUntil(self.clients.openWindow(target));
});
