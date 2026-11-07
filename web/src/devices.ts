import type { SupabaseClient } from '@supabase/supabase-js';
import { UAParser } from 'ua-parser-js';

export type CanvasMode = 'off' | 'summary' | 'reminders';
export const CANVAS_MODES: readonly (readonly [CanvasMode, string])[] = [['off', '끄기'], ['summary', '하루 요약'], ['reminders', '요약과 마감']];

export interface Device { id: string; endpoint: string; name: string | null; canvasMode: CanvasMode; createdAt: string }

// 출처: https://github.com/faisalman/ua-parser-js (원본 성공의 기기 이름 제안과 같은 방식)
export function validDeviceName(value: string): boolean {
  return value.trim().length > 0 && value.trim().length <= 40 && !/[\x00-\x1f\x7f]/.test(value);
}

/** 기기 이름 제안. 브라우저가 모델을 알려 주면(휴대폰) 모델명, 아니면 "Windows PC", "iPhone" 같은 종류 이름을 쓴다. */
export async function suggestDeviceName(userAgent: string = navigator.userAgent, hints = true): Promise<string> {
  const parser = new UAParser(userAgent);
  let device = parser.getDevice();
  if (hints) { try { device = await device.withClientHints(); } catch { /* 모델을 제공하지 않으면 기기 종류를 쓴다 */ } }
  const model = device.model?.trim();
  // 'K'는 안드로이드가 모델을 숨길 때, 'Macintosh'는 맥의 일반 이름이라 모델로 보지 않는다.
  if (model && model !== 'K' && model !== 'Macintosh' && validDeviceName(model)) return model;
  const os = parser.getOS().name ?? '';
  if (os === 'iOS') return device.type === 'tablet' ? 'iPad' : 'iPhone';
  if (os === 'Android') return device.type === 'tablet' ? '안드로이드 태블릿' : '안드로이드 휴대폰';
  if (os === 'Windows') return 'Windows PC';
  if (os === 'macOS') return 'Mac';
  return device.type === 'mobile' ? '휴대폰' : device.type === 'tablet' ? '태블릿' : 'PC';
}

const MODES = new Set<string>(['off', 'summary', 'reminders']);

/** 내 알림 기기 목록(본인 행만). 구독 주소는 열쇠라서 가져오지만 화면에는 보이지 않는다. */
export async function loadDevices(client: SupabaseClient, userId: string): Promise<Device[]> {
  const { data, error } = await client.from('user_push_subscriptions').select('id,endpoint,device_name,canvas_mode,created_at')
    .eq('user_id', userId).order('created_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).filter((row) => typeof row.id === 'string' && typeof row.endpoint === 'string').map((row) => ({
    id: row.id as string, endpoint: row.endpoint as string, name: typeof row.device_name === 'string' ? row.device_name : null,
    canvasMode: (typeof row.canvas_mode === 'string' && MODES.has(row.canvas_mode) ? row.canvas_mode : 'reminders') as CanvasMode,
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
  }));
}

export async function saveCanvasMode(client: SupabaseClient, userId: string, deviceId: string, mode: CanvasMode): Promise<void> {
  const { error } = await client.from('user_push_subscriptions').update({ canvas_mode: mode }).eq('id', deviceId).eq('user_id', userId);
  if (error) throw error;
}

export async function deleteDevice(client: SupabaseClient, userId: string, deviceId: string): Promise<void> {
  const { error } = await client.from('user_push_subscriptions').delete().eq('id', deviceId).eq('user_id', userId);
  if (error) throw error;
}

/** 하루 요약 시간(HH:MM). 아이캠퍼스 토큰을 저장하기 전에는 줄이 없어서 null이다. */
export async function loadSummaryTime(client: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await client.from('user_canvas_tokens').select('summary_time').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return typeof data?.summary_time === 'string' && /^\d{2}:\d{2}/.test(data.summary_time) ? data.summary_time.slice(0, 5) : null;
}

export async function saveSummaryTime(client: SupabaseClient, userId: string, time: string): Promise<void> {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('시간 형식이 맞지 않아요.');
  const { data, error } = await client.from('user_canvas_tokens').update({ summary_time: time }).eq('user_id', userId).select('user_id');
  if (error) throw error;
  if (!data?.length) throw new Error('아이캠퍼스 토큰을 먼저 저장해 주세요.');
}

/** "21:05" → 오전/오후, 1~12시, 분. 원본 설정의 오전·오후 + 시 + 분 입력과 같은 모양이다. */
export function summaryParts(time: string): { period: 'am' | 'pm'; hour: number; minute: number } {
  const [h, m] = time.split(':').map(Number);
  return { period: h >= 12 ? 'pm' : 'am', hour: h % 12 || 12, minute: m };
}

export function composeSummaryTime(period: 'am' | 'pm', hour: number, minute: number): string | null {
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  const h24 = (hour % 12) + (period === 'pm' ? 12 : 0);
  return `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 기기 이름을 바꾼다(40자 이내). 본인의 기기 행만 바뀐다. */
export async function saveDeviceName(client: SupabaseClient, userId: string, deviceId: string, name: string): Promise<void> {
  if (!validDeviceName(name)) throw new Error('기기 이름을 40자 이내로 적어 주세요.');
  const { error } = await client.from('user_push_subscriptions').update({ device_name: name.trim() }).eq('id', deviceId).eq('user_id', userId);
  if (error) throw error;
}
