// 알림이 꺼진 기기에 아래 패널로 켜기를 권하는 규칙.
//
// 참고한 오픈소스(코드는 가져오지 않고 규칙만 본다):
//  - OneSignal Web SDK(MIT) src/shared/helpers/dismiss.ts, markPromptDismissedWithType: 사전 안내(slidedown)를 닫을 때마다
//    닫은 횟수를 세어 1회 3일, 2회 7일, 3회 이후 30일 뒤에 다시 묻는다(2026-11-16 GitHub main에서 확인).
//    https://github.com/OneSignal/OneSignal-Website-SDK/blob/main/src/shared/helpers/dismiss.ts
//  - web.dev "Notification permission UX" https://web.dev/articles/push-notifications-permissions-ux : 페이지를 열자마자 묻지 않는다.
//    이미 서비스를 써 본 사람에게 먼저 우리 안내(수락/거절)를 보이고, 수락할 때만 브라우저 허용 창을 띄운다(이중 허용). 거절하면 숨기고 존중한다.
//    차단되면 사이트가 다시 물을 수 없고 사용자가 브라우저 설정에서 바꿔야 하므로 어떻게 끄는지 알려 준다. 다시 묻는 간격은 이 글에 없다.
//  - Chrome 개발자 문서 Lighthouse "notification-on-start" https://developer.chrome.com/docs/lighthouse/best-practices/notification-on-start :
//    로드 중 requestPermission 호출은 경고 대상이다. 어떤 알림인지 먼저 보이고 동의한 뒤에만 요청한다(우리도 단추를 누른 클릭에서만 호출한다).
//  - WebKit "Web Push for Web Apps on iOS and iPadOS" https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ :
//    iOS 16.4 이상에서 홈 화면에 추가한 웹 앱만 알림을 요청할 수 있고, 요청은 사용자 조작(단추 누름) 안에서 해야 한다(첫 설정의 iOS 안내 근거).
//  - Chrome의 조용한 알림 허용 UI와 Apple HIG의 사전 안내 문구는 문서를 열어 확인하지 못해 따르지 않았다(미확인).
// OneSignal은 영구히 멈추지 않고 30일마다 다시 묻는다. 우리도 같다(알림은 이 앱의 핵심이라 영구히 숨기지 않는다).
const DAY = 24 * 60 * 60 * 1000;
const WAIT_DAYS = [3, 7, 30];

/** 닫은 기록("횟수:시각")을 보고 알림 패널을 다시 보일지 정한다. 기록이 없으면 보이고, 깨졌으면 보이지 않는다(설치 배너와 같다). */
export function pushSheetDue(raw: string | null, now: number): boolean {
  if (raw === null) return true;
  const [count, at] = raw.split(':').map(Number);
  if (!Number.isFinite(count) || !Number.isFinite(at) || count < 1) return false;
  return now - at >= WAIT_DAYS[Math.min(count, WAIT_DAYS.length) - 1] * DAY;
}

export function pushSheetDismissed(raw: string | null, now: number): string {
  const count = Number(raw?.split(':')[0]);
  return `${Number.isFinite(count) ? count + 1 : 1}:${now}`;
}
