// 알림 켜기가 기기에서만 실패할 때 원인을 보려고 이 탭의 메모리에 짧은 기록을 남긴다. 사용자가 "진단 정보 보내기"를 누를 때만 문의(버그)로 보낸다.
// 구독 주소·키 같은 비밀은 남기지 않는다.
const started = typeof performance === 'undefined' ? 0 : performance.now();
const lines: string[] = [];

export function note(event: string): void {
  const at = typeof performance === 'undefined' ? 0 : Math.round((performance.now() - started) / 100) / 10;
  lines.push(`${at}s ${event}`);
  if (lines.length > 40) lines.shift();
}

/** 사용자 동작이 아직 살아 있는지(허용 창은 클릭 직후에만 뜬다). 지원하지 않으면 '?'. */
export function activation(): string {
  const value = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return value ? String(value.isActive) : '?';
}

export async function pushReport(registration: ServiceWorkerRegistration | null, version: string): Promise<string> {
  const ua = navigator.userAgent.match(/(SamsungBrowser|Chrome|Firefox|Version|Whale|EdgA?)\/[\d.]+/g)?.join(' ') ?? '';
  const os = navigator.userAgent.match(/Android [\d.]+|iPhone OS [\d_]+|Windows NT [\d.]+|Mac OS X [\d_]+/)?.[0] ?? '';
  let query = '?';
  try { query = (await navigator.permissions.query({ name: 'notifications' })).state; } catch { /* 지원 안 함 */ }
  let sub = '?';
  try {
    sub = await Promise.race([registration?.pushManager.getSubscription().then((value) => value ? 'yes' : 'no') ?? Promise.resolve('no-reg'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 3000))]);
  } catch (error) { sub = `error:${error instanceof Error ? error.name : ''}`; }
  const head = [
    `[알림 진단] v${version}`, `${os} ${ua}`,
    `standalone=${matchMedia('(display-mode: standalone)').matches} secure=${isSecureContext} top=${window.top === window}`,
    `perm=${typeof Notification === 'undefined' ? 'none' : Notification.permission} query=${query}`,
    `sw=${registration?.active?.state ?? 'none'} ctrl=${!!navigator.serviceWorker?.controller} sub=${sub}`,
  ].join('\n');
  // 문의 글은 500자까지라 오래된 기록부터 뺀다.
  const log = [...lines];
  let body = `${head}\n${log.join('\n')}`;
  while (body.length > 490 && log.length) { log.shift(); body = `${head}\n…\n${log.join('\n')}`; }
  return body.slice(0, 500);
}
