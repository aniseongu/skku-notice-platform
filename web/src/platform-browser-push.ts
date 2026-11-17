import { suggestDeviceName } from './devices.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { connectionChain } from './connection-chain.ts';
import { activation, note } from './push-diagnostics.ts';

const OWNER_KEY = 'platform:push-owner';
// 서버에 올린 구독 주소. 앱 업데이트 등으로 브라우저가 구독을 잃거나 새 주소로 바꾸면 이 값과 달라져서 알아챈다.
const ENDPOINT_KEY = 'platform:push-endpoint';
// 일부 브라우저(삼성 인터넷 등)는 getSubscription·ready가 끝나지 않을 때가 있다. 확인 중에 멈춰 있지 않게 끊는다.
const CHECK_MS = 10_000;
const SUBSCRIBE_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); });
  });
}

const readSubscription = (registration: ServiceWorkerRegistration) =>
  withTimeout(registration.pushManager.getSubscription(), CHECK_MS, '이 기기의 알림 상태를 확인하지 못했어요. 브라우저를 다시 열고 시도해 주세요.');
const newSubscription = (registration: ServiceWorkerRegistration, key: Uint8Array<ArrayBuffer>) =>
  withTimeout(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }), SUBSCRIBE_MS, '알림 서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.');

const SAVE_MS = 15_000;
// 허용 창이 화면에 안 뜨면(설치한 앱에는 주소창이 없어 브라우저가 작은 아이콘으로만 묻는 경우 등) 대답이 오지 않는다.
const PERMISSION_MS = 10_000;

export function permissionHelp(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  // 휴대폰 설정에서 브라우저나 홈 화면에 설치한 앱(크로미움은 설치한 앱을 따로 된 안드로이드 앱으로 둔다)의 알림이 꺼져 있으면
  // 사이트 권한이 "묻기"로 돌아가고 허용 창도 뜨지 않는다.
  return /SamsungBrowser/.test(userAgent)
    ? '알림 허용 창이 뜨지 않았어요. 다시 누르면 다른 방법으로 물어봐요. 그래도 안 되면 휴대폰 설정 → 애플리케이션에서 삼성 인터넷과 홈 화면에 설치한 앱의 알림을 켜 주세요.'
    : '알림 허용 창이 뜨지 않았어요. 다시 누르면 다른 방법으로 물어봐요. 그래도 안 되면 기기 설정에서 이 브라우저와 설치한 앱의 알림을 켜 주세요.';
}

const currentPermission = (): NotificationPermission => typeof Notification === 'undefined' ? 'default' : Notification.permission;
const DECLINED = '브라우저에서 알림을 허용해 주세요.';

/** 이 기기의 구독 주소(기기 목록에서 "이 기기"를 찾을 때). 응답하지 않는 브라우저에서는 빈 값으로 넘어간다. */
export async function deviceEndpoint(registration: ServiceWorkerRegistration): Promise<string> {
  try { return (await readSubscription(registration))?.endpoint ?? ''; } catch { return ''; }
}

// 기기 이름은 꾸밈이라 브라우저가 늦게 답하면 기다리지 않고 기기 종류 이름을 쓴다.
const deviceName = () => Promise.race([suggestDeviceName(), new Promise<string>((resolve) => setTimeout(() => resolve(suggestDeviceName(undefined, false)), 3000))]);

function forget(storage: Storage): void {
  storage.removeItem(OWNER_KEY);
  storage.removeItem(ENDPOINT_KEY);
}

async function carryOver(client: SupabaseClient, userId: string, previous: string, endpoint: string): Promise<{ canvas_mode?: string; device_name?: string }> {
  try {
    const exists = await client.from('user_push_subscriptions').select('id').eq('user_id', userId).eq('endpoint', endpoint).maybeSingle();
    if (exists.error || exists.data) return {};
    const { data, error } = await client.from('user_push_subscriptions').select('canvas_mode,device_name').eq('user_id', userId).eq('endpoint', previous).maybeSingle();
    if (error || !data) return {};
    const row = data as { canvas_mode?: unknown; device_name?: unknown };
    return {
      ...(typeof row.canvas_mode === 'string' && ['off', 'summary', 'reminders'].includes(row.canvas_mode) ? { canvas_mode: row.canvas_mode } : {}),
      ...(typeof row.device_name === 'string' && row.device_name.trim() ? { device_name: row.device_name } : {}),
    };
  } catch { return {}; }
}

async function saveDevice(client: SupabaseClient, userId: string, subscription: PushSubscription, storage: Storage, previous: string | null): Promise<void> {
  const data = subscription.toJSON();
  if (!data.endpoint || !data.keys?.p256dh || !data.keys.auth) throw new Error('알림 기기 정보를 확인하지 못했어요.');
  // 주소가 바뀐 기기는 새 줄이 기본값(요약과 마감)으로 만들어지고 옛 줄이 지워져 아이캠퍼스 알림 설정과 바꾼 이름이 사라졌다.
  // 이 주소의 줄이 아직 없을 때만 옛 줄의 값을 이어 받는다. 읽지 못하면 예전처럼 기본값으로 둔다.
  const carried = previous && previous !== data.endpoint ? await carryOver(client, userId, previous, data.endpoint) : {};
  const { error } = await withTimeout(Promise.resolve(client.from('user_push_subscriptions').upsert({
    user_id: userId, endpoint: data.endpoint, p256dh: data.keys.p256dh, auth_secret: data.keys.auth,
    device_name: carried.device_name ?? await deviceName(),
    ...(carried.canvas_mode ? { canvas_mode: carried.canvas_mode } : {}),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' })), SAVE_MS, '서버에 이 기기를 등록하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
  if (error) throw error;
  storage.setItem(OWNER_KEY, userId);
  storage.setItem(ENDPOINT_KEY, data.endpoint);
  // 이 기기가 예전에 쓰던 주소는 더 이상 받지 못한다. 남겨 두면 기기 목록에 같은 기기가 두 번 보인다.
  if (previous && previous !== data.endpoint) {
    await client.from('user_push_subscriptions').delete().eq('user_id', userId).eq('endpoint', previous).then(() => undefined, () => undefined);
  }
}

function decodeVapid(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error('알림 설정을 불러오지 못했어요.');
  return bytes;
}

function owner(storage: Storage): string | null {
  try { return storage.getItem(OWNER_KEY); } catch { throw new Error('이 브라우저에서 알림 설정을 저장할 수 없어요.'); }
}

async function dropForeign(subscription: PushSubscription | null, userId: string, storage: Storage): Promise<PushSubscription | null> {
  if (!subscription || owner(storage) === userId) return subscription;
  if (!await subscription.unsubscribe()) throw new Error('이 기기의 이전 알림을 끄지 못했어요.');
  forget(storage);
  return null;
}

async function registered(client: SupabaseClient, userId: string, endpoint: string): Promise<boolean> {
  const { data, error } = await client.from('user_push_subscriptions').select('id')
    .eq('user_id', userId).eq('endpoint', endpoint).maybeSingle();
  if (error) throw error;
  return !!data;
}

/**
 * 이 기기 알림이 켜져 있는지 확인한다. heal을 주면 끊긴 구독을 조용히 되살린다.
 * 되살리는 경우는 이 계정이 이 기기에서 알림을 켠 뒤 끄지 않았는데(소유자 표시가 남아 있음) 브라우저가 구독을 잃었거나
 * 새 주소로 바꾼 때뿐이다. 앱 업데이트 뒤 삼성 인터넷 등에서 구독이 사라지는 일이 있었다(2026-11-15).
 * 다른 기기 목록에서 지운 경우는 브라우저 구독이 그대로라서 되살리지 않는다. 권한은 이미 허용된 때만 쓰므로 묻는 창이 뜨지 않는다.
 */
export async function inspectDevicePush(client: SupabaseClient, userId: string, registration: ServiceWorkerRegistration, storage: Storage,
  heal?: { vapidKey: string | null; permission: NotificationPermission }): Promise<boolean> {
  const subscription = await dropForeign(await readSubscription(registration), userId, storage);
  if (subscription && await registered(client, userId, subscription.endpoint)) {
    storage.setItem(ENDPOINT_KEY, subscription.endpoint);   // 이 값이 없던 예전 등록도 다음부터 바뀜을 알아채게 한다
    return true;
  }
  if (!heal?.vapidKey || heal.permission !== 'granted' || owner(storage) !== userId) return false;
  const previous = storage.getItem(ENDPOINT_KEY);
  const lost = !subscription;
  const replaced = !!subscription && !!previous && subscription.endpoint !== previous;
  if (!lost && !replaced) return false;
  await saveDevice(client, userId, subscription ?? await newSubscription(registration, decodeVapid(heal.vapidKey)), storage, previous);
  return true;
}

// 권한 요청 → 구독 생성 → 서버 등록을 순서대로 실행한다. 실패하면 다시 run()할 때 끝난 단계는 건너뛰고 실패한 단계부터 이어 간다.
// 첫 단계(권한 요청)는 run()을 부른 같은 호출 안에서 시작되므로 클릭 동작 안에서 실행된다.
export function createEnableChain(client: SupabaseClient, userId: string, registration: ServiceWorkerRegistration,
  storage: Storage, vapidKey: string, requestPermission: () => Promise<NotificationPermission>,
  permission: () => NotificationPermission = currentPermission) {
  const key = decodeVapid(vapidKey);
  let subscription: PushSubscription | null = null;
  let previous: string | null = null;
  let created = false;
  let saved = false;
  let asked = 0;
  const chain = connectionChain([
    async () => {
      note(`step0 perm=${permission()} act=${activation()} vis=${typeof document === 'undefined' ? '?' : document.visibilityState}`);
      if (permission() === 'granted') return;
      // 두 번째부터는 권한을 따로 묻지 않고 다음 단계의 구독 요청이 직접 묻게 한다. 크로미움은 권한이 없으면
      // pushManager.subscribe()가 허용 창을 띄운다(Google 웹 푸시 예제가 쓰는 방식). Notification.requestPermission이
      // 허용 창을 띄우지 못한 기기(삼성 인터넷 휴대폰, 2026-11-16)에서 다른 길로 묻는다.
      if (++asked > 1) return;
      const asking = requestPermission();
      // 시간 제한 뒤에라도 브라우저가 답하는지 기록한다(조용한 요청이면 한참 뒤 'default'로 끝난다).
      asking.then((value) => note(`ask-result ${value}`), (error: unknown) => note(`ask-error ${error instanceof Error ? error.name : String(error)}`));
      const result = await withTimeout(asking, PERMISSION_MS, permissionHelp());
      if (result === 'granted') return;
      // 'default'는 고르지 않고 닫았거나 조용한 요청이 끝난 것이다(크롬 개발자 블로그: 결정 없음으로 다룬다).
      throw new Error(result === 'denied' ? DECLINED : '알림 허용을 고르지 않았어요. 다시 눌러 허용해 주세요.');
    },
    async () => {
      previous = owner(storage) === userId ? storage.getItem(ENDPOINT_KEY) : null;
      const existing = await dropForeign(await readSubscription(registration), userId, storage);
      // 꺼져 있는 상태에서 켜는 것이므로 남아 있는 구독은 서버에 없거나 이미 끊긴 주소일 수 있다(앱 업데이트 뒤 실제로 있었다).
      // 다시 쓰지 않고 새로 만든다.
      if (existing) {
        previous ??= existing.endpoint;
        // 끊긴 구독은 해제도 답이 없을 수 있다. 기다리다 넘어가도 새 구독을 만들면 브라우저가 바꿔 끼운다.
        await withTimeout(existing.unsubscribe(), CHECK_MS, '').catch(() => false);
      }
      note(`step1 perm=${permission()} act=${activation()} existing=${!!existing}`);
      if (permission() === 'granted') {
        subscription = await newSubscription(registration, key).catch((error: unknown) => {
          note(`subscribe-error ${error instanceof Error ? `${error.name}:${error.message.slice(0, 60)}` : String(error)}`);
          throw error;
        });
      }
      else {
        // 구독 요청이 허용 창을 띄운다. 거절하면 NotAllowedError가 난다.
        subscription = await withTimeout(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }), SUBSCRIBE_MS, permissionHelp())
          .catch((error: unknown) => {
            note(`subscribe-error ${error instanceof Error ? `${error.name}:${error.message.slice(0, 60)}` : String(error)}`);
            throw error instanceof Error && error.name === 'NotAllowedError' ? new Error(DECLINED) : error;
          });
      }
      created = true;
    },
    async () => {
      note('step2 save');
      await saveDevice(client, userId, subscription!, storage, previous);
      saved = true;
    },
  ]);
  return {
    run: () => chain.run(),
    // 사용자가 그만두거나 계정이 바뀌면, 서버에 등록하지 못한 채 새로 만든 구독만 이 기기에서 끊는다.
    async discard(): Promise<void> {
      if (created && !saved && subscription) await subscription.unsubscribe().catch(() => false);
    },
  };
}

export async function enableDevicePush(client: SupabaseClient, userId: string, registration: ServiceWorkerRegistration,
  storage: Storage, vapidKey: string, requestPermission: () => Promise<NotificationPermission>): Promise<void> {
  const chain = createEnableChain(client, userId, registration, storage, vapidKey, requestPermission);
  try { await chain.run(); } catch (error) { await chain.discard(); throw error; }
}

export async function disableDevicePush(client: SupabaseClient, userId: string, registration: ServiceWorkerRegistration,
  storage: Storage): Promise<boolean> {
  const subscription = await readSubscription(registration);
  if (!subscription) { forget(storage); return true; }
  if (!await subscription.unsubscribe()) throw new Error('이 기기의 알림을 끄지 못했어요.');
  forget(storage);
  const { error } = await client.from('user_push_subscriptions').delete()
    .eq('user_id', userId).eq('endpoint', subscription.endpoint);
  return !error;
}

// 계정이 바뀌거나 세션이 사라졌을 때 쓴다. 서버 행은 세션 없이 지울 수 없으므로 이 브라우저의 구독만 끊는다.
// 남은 서버 행은 발송 실패 정리로 닫힌다. 다른 사용자 소유의 구독은 건드리지 않는다.
export async function releaseDevicePush(userId: string, registration: ServiceWorkerRegistration, storage: Storage): Promise<void> {
  if (owner(storage) !== userId) return;
  const subscription = await readSubscription(registration);
  if (subscription && !await subscription.unsubscribe()) throw new Error('이 기기의 알림을 끄지 못했어요.');
  forget(storage);
}
