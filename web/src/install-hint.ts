// 로그인 화면의 "앱으로 설치하기"를 어떤 방식으로 보여 줄지 정한다.
// prompt: 브라우저가 설치 창을 열어 준다(안드로이드 크롬 등). ios: 설치 창이 없어 "홈 화면에 추가" 방법을 알려 준다. none: 보여 주지 않는다(이미 설치했거나 지원하지 않음).
export type InstallMode = 'prompt' | 'ios' | 'none';

export function installMode(userAgent: string, standalone: boolean, hasPrompt: boolean, installed = false): InstallMode {
  // 이미 설치했으면(앱으로 열었거나, 설치했다는 기록이 있으면) 설치 문구를 없앤다.
  if (standalone || installed) return 'none';
  if (hasPrompt) return 'prompt';
  // iPadOS는 데스크톱 Safari처럼 위장하므로 터치 지원 Mac은 따로 확인하지 않고 iPhone·iPad·iPod 표기만 본다.
  const ios = /iPhone|iPad|iPod/.test(userAgent);
  // iOS의 크롬·엣지·네이버 앱 등은 홈 화면 추가를 하지 못하므로 Safari일 때만 안내한다.
  const safari = /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|NAVER|DaumApps|KAKAOTALK|Instagram|FBAN|FBAV/.test(userAgent);
  return ios && safari ? 'ios' : 'none';
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as { standalone?: boolean }).standalone === true;
}

const KEY = 'skku-app-installed';
/** 설치가 끝났다는 것을 이 기기의 브라우저에 남긴다(appinstalled 이벤트). 이후 브라우저로 열어도 설치 문구가 보이지 않는다. */
export function markInstalled(): void { try { localStorage.setItem(KEY, '1'); } catch { /* 저장 공간을 못 쓰는 곳이면 기록하지 않는다 */ } }
export function wasInstalled(): boolean { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }
/** 설치한 앱으로 열렸다면 그것도 설치 기록이다(같은 브라우저 저장 공간을 쓰는 곳에서는 이후에도 보이지 않는다). */
export function noteStandalone(): void { if (isStandalone()) markInstalled(); }
