// 로그인 화면의 "앱으로 설치하기"를 어떤 방식으로 보여 줄지 정한다.
// prompt: 브라우저가 설치 창을 열어 준다(안드로이드 크롬 등). ios: 설치 창이 없어 "홈 화면에 추가" 방법을 알려 준다.
// samsung: 삼성인터넷은 설치 창 신호(beforeinstallprompt)를 주지 않는 판이 많아(27.x 보고, 주소를 replaceState로 바꾸면 안 온다는 보고) 메뉴 경로를 알려 준다.
// none: 보여 주지 않는다(이미 설치했거나 지원하지 않음).
export type InstallMode = 'prompt' | 'ios' | 'samsung' | 'none';

/** 설치 창이 없는 브라우저에서 보여 줄 방법 한 줄. 버튼이 아니라 안내다. */
export const MANUAL_INSTALL_HINT: Record<'ios' | 'samsung', { lead: string; action: string; tail: string }> = {
  ios: { lead: '공유 버튼에서 ', action: '‘홈 화면에 추가’', tail: '를 고르면 앱처럼 쓸 수 있어요' },
  samsung: { lead: '오른쪽 아래 메뉴(≡)에서 ', action: '‘현재 페이지 추가 → 홈 화면’', tail: '을 고르면 앱처럼 쓸 수 있어요' },
};

export function installMode(userAgent: string, standalone: boolean, hasPrompt: boolean): InstallMode {
  // 설치한 앱으로 열었을 때만 설치 문구를 없앤다(브라우저로 열면 보인다. 이미 설치한 크롬은 설치 창 신호 자체를 주지 않는다).
  if (standalone) return 'none';
  if (hasPrompt) return 'prompt';
  // 삼성인터넷(갤럭시 기본 브라우저). 설치 창 신호가 오면 위에서 prompt가 된다.
  if (/SamsungBrowser\//.test(userAgent) && /Android/.test(userAgent)) return 'samsung';
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
