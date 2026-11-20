// 출처: https://github.com/mdn/serviceworker-cookbook/tree/master/push-payload
// Workbox가 만든 워커에서 불러온다. 키와 구독 주소는 이 파일에 두지 않는다.
// 알림 tag `notice:<id>`의 id가 공지 id 형식(deeplink.ts의 isNoticeId와 같다)이면 앱 안의 그 공지로 연다.
const NOTICE_ID = /^[a-z0-9-]+\/[0-9]+$/;
function noticeIdOf(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('notice:')) return null;
  const id = tag.slice('notice:'.length);
  return id.length <= 200 && NOTICE_ID.test(id) ? id : null;
}

// 알림함: 받은 알림을 이 기기의 IndexedDB에 쌓는다(앱의 src/inbox.ts가 읽는다. 같은 DB·키·정리 규칙).
// 수신자 해시와 현재 구독 주소가 모두 inbox:v1의 소유자와 일치할 때 저장한다.
// 구형 서버 알림도 표시한다. 알림함 저장은 별도로 최대 3초 기다린다.
const INBOX_KEY = 'inbox:v1';
const INBOX_MAX_ITEMS = 200;
const INBOX_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const INBOX_TIMEOUT_MS = 3000;
const GENERIC_TAG = 'skku-notice';

function openKeyval() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('keyval-store');
    request.onupgradeneeded = () => request.result.createObjectStore('keyval');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('blocked'));   // 다른 탭이 버전 변경을 막고 있으면 기다리지 않는다
  });
}

function pruneInbox(items, now) {
  return items.filter((item) => now - item.at <= INBOX_MAX_AGE_MS).sort((a, b) => b.at - a.at).slice(0, INBOX_MAX_ITEMS);
}

async function saveInbox(entry, now) {
  if (typeof indexedDB === 'undefined' || typeof entry.to !== 'string' || !/^[0-9a-f]{16}$/.test(entry.to)) return false;
  const subscription = await self.registration.pushManager.getSubscription();
  const endpoint = subscription && subscription.endpoint;
  if (typeof endpoint !== 'string' || !endpoint) return false;   // 구독이 없으면(해제·전환 중) 저장하지 않는다
  const db = await openKeyval();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('keyval', 'readwrite');
      const store = tx.objectStore('keyval');
      let saved = false;
      const request = store.get(INBOX_KEY);
      request.onsuccess = () => {
        const old = request.result;
        const owner = old && old.version === 1 ? old.owner : null;
        if (!owner || typeof owner.userId !== 'string' || !owner.userId
          || owner.endpoint !== endpoint || owner.recipientHash !== entry.to) return;
        let items = Array.isArray(old.items) ? old.items : [];
        if (entry.tag !== GENERIC_TAG) items = items.filter((item) => !(item.owner === owner.userId && item.tag === entry.tag));
        const id = now.toString(36) + Math.random().toString(36).slice(2, 8);
        items.push({ id, owner: owner.userId, tag: entry.tag, title: entry.title, body: entry.body, noticeId: entry.noticeId, url: entry.url, at: now, read: false });
        store.put({ version: 1, owner, items: pruneInbox(items, now) }, INBOX_KEY);
        saved = true;
      };
      tx.oncomplete = () => resolve(saved);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function rememberInbox(entry) {
  let timer;
  try {
    const limit = new Promise((resolve) => { timer = setTimeout(resolve, INBOX_TIMEOUT_MS); });
    const write = saveInbox(entry, Date.now()).then(async (saved) => {
      if (saved && self.clients?.matchAll) {
        for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) client.postMessage({ type: 'inbox-changed' });
      }
    });
    await Promise.race([write, limit]);
  } catch { /* 알림함에 못 쌓아도 알림은 이미 떴다 */ }
  finally { clearTimeout(timer); }
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
  const tag = typeof payload.tag === 'string' ? payload.tag : GENERIC_TAG;
  // 알림 표시를 먼저 시작하고 알림함 저장은 따로 시작한다. 저장이 느리거나 실패해도 알림은 뜬다.
  const shown = self.registration.showNotification(title, {
    body,
    icon: new URL('icon-192.png', self.registration.scope).href,
    badge: new URL('icon-monochrome-512.png', self.registration.scope).href,
    tag,
    silent: payload.silent === true,
    data: { url: target.href, notice: noticeIdOf(payload.tag) },
  });
  const kept = rememberInbox({ to: payload.to, tag, title, body, noticeId: noticeIdOf(payload.tag), url: target.href });
  event.waitUntil(Promise.all([shown, kept]));
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
