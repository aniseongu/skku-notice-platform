import type { SupabaseClient } from '@supabase/supabase-js';
import { connectionChain } from './connection-chain.ts';

const OWNER_KEY = 'platform:push-owner';

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
  storage.removeItem(OWNER_KEY);
  return null;
}

export async function inspectDevicePush(client: SupabaseClient, userId: string, registration: ServiceWorkerRegistration, storage: Storage): Promise<boolean> {
  const subscription = await dropForeign(await registration.pushManager.getSubscription(), userId, storage);
  if (!subscription) return false;
  const { data, error } = await client.from('user_push_subscriptions').select('id')
    .eq('user_id', userId).eq('endpoint', subscription.endpoint).maybeSingle();
  if (error) throw error;
  return !!data;
}

// 권한 요청 → 구독 생성 → 서버 등록을 순서대로 실행한다. 실패하면 다시 run()할 때 끝난 단계는 건너뛰고 실패한 단계부터 이어 간다.
// 첫 단계(권한 요청)는 run()을 부른 같은 호출 안에서 시작되므로 클릭 동작 안에서 실행된다.
export function createEnableChain(client: SupabaseClient, userId: string, registration: ServiceWorkerRegistration,
  storage: Storage, vapidKey: string, requestPermission: () => Promise<NotificationPermission>) {
  const key = decodeVapid(vapidKey);
  let subscription: PushSubscription | null = null;
  let created = false;
  let saved = false;
  const chain = connectionChain([
    async () => { if (await requestPermission() !== 'granted') throw new Error('브라우저에서 알림을 허용해 주세요.'); },
    async () => {
      subscription = await dropForeign(await registration.pushManager.getSubscription(), userId, storage);
      const currentKey = subscription?.options.applicationServerKey;
      if (subscription && currentKey) {
        const bytes = new Uint8Array(currentKey);
        if (bytes.length !== key.length || bytes.some((value, index) => value !== key[index])) {
          if (!await subscription.unsubscribe()) throw new Error('이 기기의 이전 알림을 끄지 못했어요.');
          storage.removeItem(OWNER_KEY);
          subscription = null;
        }
      }
      created = !subscription;
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    },
    async () => {
      const data = subscription!.toJSON();
      if (!data.endpoint || !data.keys?.p256dh || !data.keys.auth) throw new Error('알림 기기 정보를 확인하지 못했어요.');
      const { error } = await client.from('user_push_subscriptions').upsert({
        user_id: userId, endpoint: data.endpoint, p256dh: data.keys.p256dh, auth_secret: data.keys.auth,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'endpoint' });
      if (error) throw error;
      storage.setItem(OWNER_KEY, userId);
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
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) { storage.removeItem(OWNER_KEY); return true; }
  if (!await subscription.unsubscribe()) throw new Error('이 기기의 알림을 끄지 못했어요.');
  storage.removeItem(OWNER_KEY);
  const { error } = await client.from('user_push_subscriptions').delete()
    .eq('user_id', userId).eq('endpoint', subscription.endpoint);
  return !error;
}

// 계정이 바뀌거나 세션이 사라졌을 때 쓴다. 서버 행은 세션 없이 지울 수 없으므로 이 브라우저의 구독만 끊는다.
// 남은 서버 행은 발송 실패 정리로 닫힌다. 다른 사용자 소유의 구독은 건드리지 않는다.
export async function releaseDevicePush(userId: string, registration: ServiceWorkerRegistration, storage: Storage): Promise<void> {
  if (owner(storage) !== userId) return;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription && !await subscription.unsubscribe()) throw new Error('이 기기의 알림을 끄지 못했어요.');
  storage.removeItem(OWNER_KEY);
}
