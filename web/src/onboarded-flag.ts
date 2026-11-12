// 이 기기에서 계정별로 "첫 설정을 마쳤다"를 기억한다. 프로필을 읽기 전에 첫 설정으로 바로 갈지 정하는 데만 쓰고,
// 서버의 onboardedAt이 항상 기준이다. 키에 사용자 id가 들어가므로 다른 계정의 표시를 이 계정의 것으로 보지 않는다.
export function onboardedKey(userId: string): string {
  return `platform:onboarded:${userId}`;
}
export function isRememberedOnboarded(userId: string | null): boolean {
  if (!userId) return false;
  try { return localStorage.getItem(onboardedKey(userId)) === '1'; } catch { return false; }
}
export function rememberOnboarded(userId: string, done: boolean): void {
  try {
    if (done) localStorage.setItem(onboardedKey(userId), '1');
    else localStorage.removeItem(onboardedKey(userId));
  } catch { /* 사생활 보호 모드에서는 기억하지 않는다 */ }
}
