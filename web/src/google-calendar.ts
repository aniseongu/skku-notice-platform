// 구글 캘린더 자동 연결(docs/plans/2026-11-03_google-calendar-sync.md).
// 출처: https://github.com/aniseongu/WhaleExtentions/blob/main/extensions/icampus-check/gcal.js (범위, 코드 흐름, PKCE)
// 브라우저는 한 번 승인만 받고, 갱신 토큰과 비밀번호는 GitHub Secrets로만 보낸다. 일정은 Actions가 15분마다 맞춘다.
import { readVariable, saveSecret, saveVariable } from './github';
import { connectionChain } from './connection-chain';

const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const CALENDAR_NAME = '성대 공지';
export const GOOGLE_SECRETS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'] as const;
// 캘린더 id는 열쇠가 아니라서 변수로 둔다. 다시 연결할 때 같은 캘린더를 쓰려고 읽는다.
export const CALENDAR_VARIABLE = 'GOOGLE_CALENDAR_ID';

export class GoogleError extends Error {}

const pendingKey = (repo: string) => `google-calendar-pending:${repo}`;
function pendingCalendar(repo: string): string {
  try { return localStorage.getItem(pendingKey(repo)) ?? ''; } catch { return ''; }
}
function rememberCalendar(repo: string, id: string | null): void {
  try {
    if (id) localStorage.setItem(pendingKey(repo), id);
    else localStorage.removeItem(pendingKey(repo));
  } catch { /* 다음 단계는 이 탭의 메모리에서 계속 시도한다 */ }
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const redirectUri = () => new URL('oauth-callback.html', document.baseURI).href;

export function validClientId(value: string) { return /^[\w-]+\.apps\.googleusercontent\.com$/.test(value.trim()); }

// 연결 오류를 캘린더 삭제로 오인하면 재시도마다 새 캘린더가 생긴다.
export async function existingCalendar(repo: string, token: string, headers: HeadersInit): Promise<string> {
  const stored = await readVariable(repo, token, CALENDAR_VARIABLE);
  const calendarId = pendingCalendar(repo) || stored || '';
  if (!calendarId) return '';
  const found = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`, { headers });
  if (found.status === 404 || found.status === 410) { rememberCalendar(repo, null); return ''; }
  if (!found.ok) throw new GoogleError('기존 캘린더를 확인하지 못했어요. 잠시 뒤 다시 연결해 주세요');
  return calendarId;
}

// 팝업은 단추를 누른 그 순간에 열어야 막히지 않는다. 그래서 먼저 열고 주소는 나중에 넣는다.
function waitForCode(popup: Window, state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel('google-oauth');
    const timer = window.setInterval(() => {
      if (popup.closed) { cleanup(); reject(new GoogleError('구글 창이 닫혔어요. 다시 눌러 주세요')); }
    }, 800);
    const cleanup = () => { channel.close(); clearInterval(timer); };
    channel.onmessage = (event: MessageEvent<{ code?: string; state?: string; error?: string }>) => {
      if (event.data?.state !== state) return;
      cleanup();
      if (event.data.code) resolve(event.data.code);
      else reject(new GoogleError(event.data.error === 'access_denied' ? '구글에서 허용하지 않았어요' : '구글 연결이 끝나지 않았어요. 클라이언트 설정을 확인해 주세요'));
    };
  });
}

async function google(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const code = String(body.error ?? response.status);
    // 오류 이름은 비밀이 아니라서 보여 준다. 어느 값을 고쳐야 하는지 바로 알 수 있다.
    if (code === 'invalid_client') throw new GoogleError('보안 비밀번호가 맞지 않아요(invalid_client). 구글 클라우드에서 보안 비밀번호를 새로 추가해 바로 복사해 넣어 주세요');
    if (code === 'redirect_uri_mismatch') throw new GoogleError('돌아올 주소가 클라이언트에 없어요(redirect_uri_mismatch). 리디렉션 URI를 확인해 주세요');
    if (code === 'unauthorized_client' || code === 'invalid_grant') throw new GoogleError(`구글이 이 연결을 받지 않았어요(${code}). 연결하기를 다시 눌러 주세요`);
    throw new GoogleError(`구글이 요청을 받지 않았어요(오류 ${response.status}). 잠시 뒤 다시 눌러 주세요`);
  }
  return body;
}

export async function connectGoogleCalendar(repo: string, token: string, clientId: string, clientSecret: string) {
  const popup = window.open('about:blank', 'google-oauth', 'popup,width=480,height=640');
  if (!popup) throw new GoogleError('팝업이 막혔어요. 주소창에서 팝업을 허용해 주세요');
  const verifier = random() + random();
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = random();
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri(), response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state,
  }).toString();
  popup.location.href = auth.href;
  const code = await waitForCode(popup, state);
  const tokens = await google('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret, code_verifier: verifier,
      redirect_uri: redirectUri(), grant_type: 'authorization_code',
    }),
  });
  const access = String(tokens.access_token ?? '');
  const refresh = String(tokens.refresh_token ?? '');
  if (!access || !refresh) throw new GoogleError('구글이 오래 쓰는 열쇠를 주지 않았어요. 구글 계정 권한에서 이 앱을 지우고 다시 연결해 주세요');
  const headers = { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' };
  // 예전에 만든 캘린더가 있으면 그대로 쓴다(다시 연결해도 캘린더가 늘지 않게).
  let calendarId = '';
  let creationAttempted = false;
  return connectionChain([
    async () => { calendarId = await existingCalendar(repo, token, headers); },
    async () => {
      if (calendarId) return;
      if (creationAttempted) throw new GoogleError('캘린더 생성 결과를 확인하지 못했어요. 구글 캘린더를 확인한 뒤 처음부터 다시 연결해 주세요');
      creationAttempted = true;
      let created: Record<string, unknown>;
      try {
        created = await google('https://www.googleapis.com/calendar/v3/calendars', {
          method: 'POST', headers,
          body: JSON.stringify({ summary: CALENDAR_NAME, timeZone: 'Asia/Seoul', description: '저장한 공지의 마감을 넣는 캘린더예요' }),
        });
      } catch {
        throw new GoogleError('캘린더 생성 결과를 확인하지 못했어요. 구글 캘린더를 확인한 뒤 처음부터 다시 연결해 주세요');
      }
      calendarId = String(created.id ?? '');
      if (!calendarId) throw new GoogleError('캘린더를 만들지 못했어요');
      rememberCalendar(repo, calendarId);
    },
    // 하나의 Secret으로 바꿔야 중간 실패가 이전 자격 증명을 섞지 않는다.
    async () => { await saveSecret(repo, token, 'GOOGLE_CONNECTION', JSON.stringify({
      client_id: clientId.trim(), client_secret: clientSecret.trim(), refresh_token: refresh, calendar_id: calendarId,
    })); },
    async () => { await saveVariable(repo, token, CALENDAR_VARIABLE, calendarId); rememberCalendar(repo, null); },
  ]);
}
