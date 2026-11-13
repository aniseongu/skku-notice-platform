// 예전 개인용 서비스 워커가 모든 JSON을 저장하던 캐시와, 공개 공지 스냅샷 캐시를 지운다.
// 공지는 로그인한 사용자만 읽으므로 공지 JSON은 어떤 캐시에도 남기지 않는다.
self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([caches.delete('api'), caches.delete('public-notices-v1')]));
});
