import type { SupabaseClient } from '@supabase/supabase-js';

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

export async function enableDevicePush(client: SupabaseClient, userId: string, registration: ServiceWorkerRegistration,
  storage: Storage, vapidKey: string, requestPermission: () => Promise<NotificationPermission>): Promise<void> {
  const key = decodeVapid(vapidKey);
  if (await requestPermission() !== 'granted') throw new Error('브라우저에서 알림을 허용해 주세요.');
  let subscription = await dropForeign(await registration.pushManager.getSubscription(), userId, storage);
  const currentKey = subscription?.options.applicationServerKey;
  if (subscription && currentKey) {
    const bytes = new Uint8Array(currentKey);
    if (bytes.length !== key.length || bytes.some((value, index) => value !== key[index])) {
      if (!await subscription.unsubscribe()) throw new Error('이 기기의 이전 알림을 끄지 못했어요.');
      storage.removeItem(OWNER_KEY);
      subscription = null;
    }
  }
  const created = !subscription;
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  try {
    const data = subscription.toJSON();
    if (!data.endpoint || !data.keys?.p256dh || !data.keys.auth) throw new Error('알림 기기 정보를 확인하지 못했어요.');
    const { error } = await client.from('user_push_subscriptions').upsert({
      user_id: userId, endpoint: data.endpoint, p256dh: data.keys.p256dh, auth_secret: data.keys.auth,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    if (error) throw error;
    storage.setItem(OWNER_KEY, userId);
  } catch (error) {
    if (created) await subscription.unsubscribe().catch(() => false);
    throw error;
  }
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
