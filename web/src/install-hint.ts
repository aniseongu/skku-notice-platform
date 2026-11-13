// 로그인 화면의 "앱으로 설치하기"를 어떤 방식으로 보여 줄지 정한다.
// prompt: 브라우저가 설치 창을 열어 준다(beforeinstallprompt 신호). 신호가 오면 늘 이 단추가 먼저다.
// 나머지는 설치 창이 없어 브라우저별 메뉴 경로를 한 줄로 알려 준다. none: 보여 주지 않는다(이미 설치했거나 안내할 길이 없음).
//   ios: iOS Safari. ios-browser: iOS 16.4+ 크롬·엣지(공유 메뉴에 "홈 화면에 추가"가 있다).
//   ios-open-safari: iOS 파이어폭스(공유 메뉴의 홈 화면 추가를 확인하지 못해 Safari로 안내).
//   samsung: 삼성인터넷(27.x 등에서 설치 창 신호가 안 오는 보고가 많다).
//   firefox: 안드로이드 파이어폭스(메뉴 → 설치). menu: 그 밖의 안드로이드 브라우저(웨일·엣지·오페라 등)는 메뉴의 "홈 화면에 추가".
//   in-app: 카카오톡·네이버 앱·인스타그램 등 앱 속 브라우저(설치가 안 되므로 다른 브라우저로 열기).
//
// 감지 규칙과 단계는 다음 오픈소스(둘 다 MIT, 코드는 가져오지 않고 규칙과 문구만 참고)를 보았다.
//  - khmyznikov/pwa-install: iOS 인앱 FBAN|FBAV, Instagram, 크롬 CriOS, 파이어폭스 FxiOS, 삼성 SamsungBrowser, 오페라 OPR, 엣지 Edg 구분, 인앱은 "다른 브라우저로 열기" 안내
//  - philfung/add-to-homescreen: iOS Safari 판별(Safari이면서 CriOS·FxiOS·FBAN·Instagram·LinkedInApp 등이 아님), 크롬 iOS "더보기 → 홈 화면에 추가", 안드로이드 엣지 "홈 화면에 추가"
// 파이어폭스 안드로이드는 Mozilla 지원 문서(메뉴 → 설치), 삼성인터넷은 Samsung Internet Dev Hub·삼성 커뮤니티(메뉴 → 현재 페이지 추가 → 홈 화면)를 따른다.
// 확인하지 못한 곳(웨일·오페라의 정확한 메뉴 이름)은 메뉴 이름을 지어내지 않고 일반 문구를 쓴다.
export type InstallMode = 'prompt' | 'ios' | 'ios-browser' | 'ios-open-safari' | 'samsung' | 'firefox' | 'menu' | 'in-app' | 'none';
export type ManualInstallMode = Exclude<InstallMode, 'prompt' | 'none'>;

/** 설치 창이 없는 브라우저에서 보여 줄 방법 한 줄. 버튼이 아니라 안내다. */
export const MANUAL_INSTALL_HINT: Record<ManualInstallMode, { lead: string; action: string; tail: string }> = {
  // iOS 26 Safari 기본(작은) 배치는 공유 버튼이 ⋯ 안에 있다. 위·아래 배치는 공유 버튼이 바로 보인다(2026-11-13 확인).
  ios: { lead: '공유 버튼(안 보이면 ⋯)에서 ', action: '‘홈 화면에 추가’', tail: '를 누르면 앱처럼 쓸 수 있어요' },
  // iOS 16.4부터 크롬·엣지도 공유 메뉴로 홈 화면에 추가할 수 있다(9to5mac 2023-07, Apple WebKit 블로그).
  'ios-browser': { lead: '주소창 옆 공유 버튼에서 ', action: '‘홈 화면에 추가’', tail: '를 누르면 앱처럼 쓸 수 있어요' },
  'ios-open-safari': { lead: '', action: 'Safari', tail: '로 열어 공유 버튼에서 ‘홈 화면에 추가’를 누르면 앱처럼 쓸 수 있어요' },
  // 삼성 안내: 메뉴(≡) → 현재 페이지 추가 → 홈 화면. 메뉴 이름은 따로 따옴표로 묶어 한 항목으로 읽히지 않게 한다.
  samsung: { lead: '오른쪽 아래 메뉴(≡)에서 ', action: '‘현재 페이지 추가’ → ‘홈 화면’', tail: '을 누르면 앱처럼 쓸 수 있어요' },
  // 파이어폭스 안드로이드는 주소창이 기본으로 아래라 메뉴 위치를 적지 않는다. 설치할 수 있는 사이트는 ‘설치’, 아니면 ‘홈 화면에 추가’로 보인다.
  firefox: { lead: '메뉴(⋮)에서 ', action: '‘설치’나 ‘홈 화면에 추가’', tail: '를 누르면 앱처럼 쓸 수 있어요' },
  menu: { lead: '브라우저 메뉴(⋮)에서 ', action: '‘홈 화면에 추가’', tail: '를 누르면 앱처럼 쓸 수 있어요' },
  'in-app': { lead: '앱 안에서는 설치할 수 없어요. 메뉴에서 ', action: '‘다른 브라우저로 열기’', tail: '를 누른 뒤 설치해 주세요' },
};

// 앱 속 브라우저(웹뷰) 표지. 카카오톡, 네이버 앱, 다음 앱, 인스타그램, 페이스북, 라인, 밴드, 링크드인, 트위터.
const IN_APP = /KAKAOTALK|NAVER\(inapp|DaumApps|Instagram|FBAN|FBAV|FB_IAB|Line\/|BAND\/|LinkedInApp|Twitter/i;

export function installMode(userAgent: string, standalone: boolean, hasPrompt: boolean): InstallMode {
  // 설치한 앱으로 열었을 때만 설치 문구를 없앤다(브라우저로 열면 보인다. 이미 설치한 크롬은 설치 창 신호 자체를 주지 않는다).
  if (standalone) return 'none';
  if (hasPrompt) return 'prompt';
  // 앱 속 브라우저는 어떤 OS에서든 설치가 안 되므로 먼저 거른다. 네이버 웨일(WhaleBrowser)은 앱 속 브라우저가 아니다.
  if (IN_APP.test(userAgent) && !/Whale/i.test(userAgent)) return 'in-app';
  // iPadOS는 데스크톱 Safari처럼 위장하므로 터치 지원 Mac은 따로 확인하지 않고 iPhone·iPad·iPod 표기만 본다.
  if (/iPhone|iPad|iPod/.test(userAgent)) {
    if (/CriOS|EdgiOS/.test(userAgent)) return 'ios-browser';
    if (/FxiOS/.test(userAgent)) return 'ios-open-safari';
    // 크롬·파이어폭스 표지가 없는 Safari 표기만 Safari로 본다(오페라 터치 등 그 밖은 안내하지 않는다).
    return /Safari/.test(userAgent) && /Version\//.test(userAgent) && !/OPT\/|OPiOS/.test(userAgent) ? 'ios' : 'none';
  }
  if (!/Android/.test(userAgent)) return 'none';
  // 삼성인터넷(갤럭시 기본 브라우저). 설치 창 신호가 오면 위에서 prompt가 된다.
  if (/SamsungBrowser\//.test(userAgent)) return 'samsung';
  if (/Firefox\//.test(userAgent)) return 'firefox';
  // 웨일·엣지·오페라는 메뉴 이름을 확인하지 못했거나 설치 창 신호가 없을 때의 대비다. 크롬은 설치했거나 조건이 안 맞으면 신호가 없어 안내하지 않는다.
  if (/Whale|EdgA|OPR\/|OPT\//.test(userAgent)) return 'menu';
  return 'none';
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as { standalone?: boolean }).standalone === true;
}
