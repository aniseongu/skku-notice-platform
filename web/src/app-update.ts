// 이용 중에 새 버전이 나와도 화면을 갑자기 바꾸지 않는다. 새 서비스 워커는 설치만 하고 기다리며(registerType: 'prompt'),
// 사용자가 "지금 바꾸기"를 눌렀을 때만 바꿔 끼운다. 입력 중이던 글(문의, 첫 설정)을 잃지 않게 하려는 것이다.
// 출처: https://vite-pwa-org.netlify.app/guide/prompt-for-update.html, https://vite.dev/guide/build#load-error-handling
type Listener = () => void;
const listeners = new Set<Listener>();
let apply: (() => void) | null = null;
let dismissed = false;

const emit = () => { for (const listener of listeners) listener(); };

/** 새 버전이 준비됐다. apply는 사용자가 누르면 실행한다(서비스 워커를 바꾸고 다시 연다). */
export function markUpdateReady(run: () => void): void {
  apply = run;
  dismissed = false;
  emit();
}

export function subscribeUpdate(listener: Listener): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function updateAvailable(): boolean { return apply !== null && !dismissed; }
export function applyUpdate(): void { apply?.(); }
/** "나중에": 이번 방문 동안은 다시 묻지 않는다. 앱을 닫았다 열면 새 버전이 저절로 적용된다. */
export function dismissUpdate(): void { dismissed = true; emit(); }

/** 테스트용: 상태를 처음으로 돌린다. */
export function resetUpdate(): void { apply = null; dismissed = false; listeners.clear(); }

/** 처음 열고 아직 아무것도 만지지 않았으면 안전하게 바로 바꿔도 된다(잃을 입력이 없다). */
export function safeToSwapSilently(now: number, interacted: boolean, windowMs = 15_000): boolean {
  return !interacted && now < windowMs;
}
