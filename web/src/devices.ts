import type { SupabaseClient } from '@supabase/supabase-js';

export type CanvasMode = 'off' | 'summary' | 'reminders';
export const CANVAS_MODES: readonly (readonly [CanvasMode, string])[] = [['off', '끄기'], ['summary', '하루 요약'], ['reminders', '요약과 마감']];

export interface Device { id: string; endpoint: string; name: string | null; canvasMode: CanvasMode; createdAt: string }

/** 브라우저가 알려 주는 정보로 "Windows · Whale" 같은 기기 이름을 만든다(원본은 이름을 직접 정하거나 제안받았다). */
export function deviceLabel(userAgent: string): string {
  const os = /Windows/i.test(userAgent) ? 'Windows' : /Android/i.test(userAgent) ? 'Android' : /iPhone|iPad|iPod/i.test(userAgent) ? 'iOS'
    : /Mac OS X|Macintosh/i.test(userAgent) ? 'Mac' : /Linux|X11/i.test(userAgent) ? 'Linux' : '';
  const browser = /Whale\//i.test(userAgent) ? 'Whale' : /Edg\//i.test(userAgent) ? 'Edge' : /SamsungBrowser/i.test(userAgent) ? 'Samsung Internet'
    : /Firefox\//i.test(userAgent) ? 'Firefox' : /Chrome\//i.test(userAgent) || /CriOS/i.test(userAgent) ? 'Chrome' : /Safari\//i.test(userAgent) ? 'Safari' : '';
  return [os, browser].filter(Boolean).join(' · ') || '이름 없는 기기';
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
