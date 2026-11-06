// 브라우저에 남는 개인 UI 상태를 계정별로 구분한다. 서버 측 권한 검사의 대체가 아니다.
let owner = 'guest';
export function setLocalOwner(userId: string | null): void {
  owner = userId ? `user:${userId}` : 'guest';
}
export function localKey(key: string): string {
  return `platform:${owner}:${key}`;
}
