import { del, get, update } from 'idb-keyval';
import type { AiKeyStatus, AiPreferences } from './ai-providers';
import type { ByokStatus, CanvasStatus, GoogleAutoStatus } from './byok';
import type { Device } from './devices';
import type { UserProfile } from './profile';

export type SettingsDevice = Omit<Device, 'endpoint'>;
export type SettingsPush = 'unsupported' | 'off' | 'on' | 'denied';

export interface SettingsData {
  profile: UserProfile;
  ai: { available: boolean; status: ByokStatus | null; keys: AiKeyStatus[]; prefs: AiPreferences; backfill: number };
  canvas: CanvasStatus | null;
  push: SettingsPush;
  devices: { items: SettingsDevice[]; thisId: string | null; summaryTime: string | null };
  calendar: { connected: boolean; syncedAt: string | null; auto: GoogleAutoStatus };
  subscriptions: string[];
  keywords: string[];
  boardOrder: string[];
}

type SettingsCache = { version: 1; data: Partial<SettingsData> };
const key = (userId: string) => `settings-cache:${userId}`;

export async function loadSettingsCache(userId: string): Promise<Partial<SettingsData> | null> {
  try {
    const cached = await get<SettingsCache>(key(userId));
    return cached?.version === 1 ? cached.data : null;
  } catch { return null; }
}

export async function saveSettingsCache(userId: string, patch: Partial<SettingsData>): Promise<void> {
  try {
    // Individual requests can finish in any order. Merge in the same IndexedDB transaction.
    await update<SettingsCache>(key(userId), (cached) => ({
      version: 1,
      data: { ...(cached?.version === 1 ? cached.data : {}), ...patch },
    }));
  } catch { /* IndexedDB is optional. */ }
}

export async function clearSettingsCache(userId: string): Promise<void> {
  try { await del(key(userId)); } catch { /* IndexedDB is optional. */ }
}
