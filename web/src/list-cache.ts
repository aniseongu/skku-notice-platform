import { get, set, del } from 'idb-keyval';
import type { Notice, Source } from './data.ts';
import type { MyJudgment } from './my-notices.ts';
import type { MyNoticeInfo, MyTranslationTitle } from './byok.ts';
import type { GraduationStatuses } from './graduation-assessment.ts';

type Store = { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void>; del(key: string): Promise<void> };
const defaultStore: Store = { get, set, del };
export interface ListCache {
  generatedAt: string; sources: Source[]; notices: Notice[]; subscriptions: string[]; keywords: string[]; boardOrder: string[];
  deadlines: Map<string, Pick<MyNoticeInfo, 'deadline' | 'deadlineKind'>>;
  judgments: Map<string, MyJudgment>; interests: Map<string, string[]>;
  translations: Map<string, MyTranslationTitle>; graduation: Map<string, GraduationStatuses>;
}
const key = (userId: string) => `list-cache:v1:${userId}`;
const noticeFields = ['id', 'source_id', 'article_no', 'title', 'category', 'url', 'posted_on', 'pinned', 'deadline', 'expires_at', 'first_seen', 'dup_key', 'dup_text_key', 'title_ko', 'deadline_kind', 'changed_at', 'change_kind', 'previous_title'] as const;
function pick<T>(value: T, fields: readonly string[]): T {
  return Object.fromEntries(fields.filter((field) => Object.prototype.hasOwnProperty.call(value, field)).map((field) => [field, (value as Record<string, unknown>)[field]])) as T;
}
export async function saveListCache(userId: string, data: ListCache, store: Store = defaultStore): Promise<void> {
  try {
    const notices = data.notices.slice(0, 1000).map((n) => pick(n, noticeFields));
    const ids = new Set(notices.map((n) => n.id));
    const entries = <T, U>(map: Map<string, T>, select: (value: T) => U) => Array.from(map).filter(([id]) => ids.has(id)).map(([id, value]) => [id, select(value)]);
    await store.set(key(userId), { version: 1, generatedAt: data.generatedAt, sources: data.sources.map((s) => pick(s, ['id', 'name', 'url', 'external', 'coop', 'shared_board'])), notices,
      subscriptions: [...data.subscriptions], keywords: [...data.keywords], boardOrder: [...data.boardOrder],
      deadlines: entries(data.deadlines, (v) => pick(v, ['deadline', 'deadlineKind'])),
      judgments: entries(data.judgments, (v) => pick(v, ['verdict', 'reason', 'model', 'deadline', 'deadlineKind'])),
      interests: entries(data.interests, (v) => [...v]), translations: entries(data.translations, (v) => pick(v, ['title'])),
      graduation: entries(data.graduation, (v) => ({ dept: v.dept, p3: v.p3, ...(v.period ? { period: pick(v.period, ['start', 'end', 'days']) } : {}) })) });
  } catch { /* IndexedDB is optional. */ }
}
export async function loadListCache(userId: string, store: Store = defaultStore): Promise<ListCache | null> {
  try {
    const value = await store.get(key(userId)) as Record<string, unknown> | undefined;
    if (!value || value.version !== 1 || typeof value.generatedAt !== 'string' || !['sources', 'notices', 'subscriptions', 'keywords', 'boardOrder', 'deadlines', 'judgments', 'interests', 'translations', 'graduation'].every((field) => Array.isArray(value[field]))) return null;
    return { ...value, deadlines: new Map(value.deadlines as never), judgments: new Map(value.judgments as never), interests: new Map(value.interests as never), translations: new Map(value.translations as never), graduation: new Map(value.graduation as never) } as unknown as ListCache;
  } catch { return null; }
}
export async function clearListCache(userId: string, store: Store = defaultStore): Promise<void> {
  try { await store.del(key(userId)); } catch { /* IndexedDB is optional. */ }
}
