// 출처: https://github.com/mdn/serviceworker-cookbook/tree/master/push-payload
// Workbox가 만든 워커에서 불러온다. 키와 구독 주소는 이 파일에 두지 않는다.
// 알림 tag `notice:<id>`의 id가 공지 id 형식(deeplink.ts의 isNoticeId와 같다)이면 앱 안의 그 공지로 연다.
const NOTICE_ID = /^[a-z0-9-]+\/[0-9]+$/;
function noticeIdOf(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('notice:')) return null;
  const id = tag.slice('notice:'.length);
  return id.length <= 200 && NOTICE_ID.test(id) ? id : null;
}

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
    data: { url: target.href, notice: noticeIdOf(payload.tag) },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // 공지 알림은 원문이 아니라 앱 안의 그 공지(./?notice=<id>)로 연다. 열린 앱 창이 있으면 그 창을 앞으로 가져와 이동한다.
  // 그 밖의 알림(아이캠퍼스, 필수 정보, 옛 알림)은 push 수신 때 검사한 URL을 그대로 연다.
  const noticeId = noticeIdOf(event.notification.tag) ?? (NOTICE_ID.test(event.notification.data?.notice || '') ? event.notification.data.notice : null);
  if (noticeId) {
    const link = new URL('./', self.registration.scope);
    link.searchParams.set('notice', noticeId);
    event.waitUntil((async () => {
      try {
        const windows = self.clients.matchAll ? await self.clients.matchAll({ type: 'window', includeUncontrolled: true }) : [];
        const open = windows.find((client) => typeof client.url === 'string' && client.url.startsWith(self.registration.scope));
        if (open) { await open.focus(); await open.navigate(link.href); return; }
      } catch { /* 창을 옮기지 못하면 새 창으로 연다 */ }
      await self.clients.openWindow(link.href);
    })());
    return;
  }
  const target = event.notification.data?.url || self.registration.scope;
  event.waitUntil(self.clients.openWindow(target));
});

// 브라우저가 구독을 바꾸거나 잃으면(앱 업데이트 뒤 등) 같은 서버 키로 바로 새 구독을 만든다.
// 이 워커에는 로그인 정보가 없어서 서버 등록은 앱을 열 때 페이지가 이어서 한다(바뀐 주소를 알아채고 다시 올린다).
// 출처: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/pushsubscriptionchange_event
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    if (await self.registration.pushManager.getSubscription()) return;
    let key = event.oldSubscription?.options?.applicationServerKey;
    if (!key) {
      const config = await (await fetch(new URL('push-config.json', self.registration.scope), { cache: 'no-store' })).json();
      const value = String(config.vapidPublicKey || '');
      const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
      key = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    }
    await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  })().catch(() => { /* 앱을 열면 페이지가 다시 등록한다 */ }));
});
