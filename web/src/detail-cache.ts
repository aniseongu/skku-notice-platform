import { del, get, update } from 'idb-keyval';
import type { MyNoticeInfo, MyTranslation } from './byok';
import type { GraduationAssessment } from './graduation-assessment';
import type { Opportunity } from './opportunities';

export type DetailFields = {
  info: MyNoticeInfo;
  translation: MyTranslation;
  graduation: GraduationAssessment;
  opportunity: Opportunity;
};
type Entry = { [K in keyof DetailFields]?: { at: number; value: DetailFields[K] } };
const key = (userId: string) => `detail-cache:v1:${userId}`;
const maxAge = 30 * 24 * 60 * 60 * 1000;
const maxEntries = 300;
const fields = ['info', 'translation', 'graduation', 'opportunity'] as const;

function prune(entry: Entry, cutoff: number): Entry {
  return Object.fromEntries(fields.flatMap((field) => {
    const item = entry[field];
    return item && item.at >= cutoff ? [[field, item]] : [];
  }));
}

export async function loadDetailCache(userId: string, noticeId: string): Promise<Partial<DetailFields>> {
  try {
    const entries = await get<Map<string, Entry>>(key(userId));
    const entry = prune(entries?.get(noticeId) ?? {}, Date.now() - maxAge);
    return Object.fromEntries(fields.flatMap((field) => entry[field] ? [[field, entry[field].value]] : []));
  } catch { return {}; }
}

export async function saveDetailField<K extends keyof DetailFields>(
  userId: string, noticeId: string, field: K, value: DetailFields[K] | null, current: () => boolean,
): Promise<void> {
  if (!current()) return;
  try {
    await update<Map<string, Entry>>(key(userId), (stored) => {
      if (!current()) throw new Error('Account changed');
      const at = Date.now();
      const entries = new Map<string, Entry>();
      for (const [id, entry] of stored ?? []) {
        const fresh = prune(entry, at - maxAge);
        if (Object.keys(fresh).length) entries.set(id, fresh);
      }
      const entry = entries.get(noticeId) ?? {};
      if (value === null) delete entry[field];
      else Object.assign(entry, { [field]: { at, value } });
      entries.delete(noticeId);
      if (Object.keys(entry).length) entries.set(noticeId, entry);
      return new Map([...entries].slice(-maxEntries));
    });
  } catch { /* IndexedDB is optional. */ }
}

export async function clearDetailCache(userId: string): Promise<void> {
  try { await del(key(userId)); } catch { /* IndexedDB is optional. */ }
}
