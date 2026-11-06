// 예전 개인용 서비스 워커가 모든 JSON을 저장하던 캐시를 더 이상 사용하지 않는다.
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.delete('api'));
});
