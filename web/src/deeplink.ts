// 공지 딥링크 `./?notice=<id>`와 비로그인 미리보기 데이터. 규칙은 스킬 share-deeplink-preview.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Notice, NoticeBody } from './data';

/** DB 함수 get_public_notice와 같은 id 형식(출처/숫자). 200자 이하만 받는다. */
export function isNoticeId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200 && /^[a-z0-9-]+\/[0-9]+$/.test(value);
}

/** 앱 안 공지 주소. id의 슬래시는 인코딩하고 기준 주소의 다른 쿼리(?api 등)와 해시는 버린다. */
export function noticeLink(id: string, base: string): string {
  const url = new URL('./', base);
  url.search = `?notice=${encodeURIComponent(id)}`;
  return url.href;
}

/** 주소의 ?notice= 값. 형식이 맞지 않으면 null(평소 화면). */
export function noticeIdFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get('notice');
  return isNoticeId(value) ? value : null;
}

/** 현재 주소에서 notice만 지운 주소(다른 쿼리는 유지). */
export function withoutNotice(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('notice');
  return url.href;
}

export interface PublicNotice { notice: Notice; source: string; external: boolean; body: NoticeBody }

interface PublicRow {
  id: string; source_id: string; source_name: string; external: boolean | null; title: string; category: string | null;
  url: string; posted_on: string; deadline: string | null; body: string | null; body_html: string | null;
}

export function publicRowToNotice(row: PublicRow): PublicNotice {
  const article = row.id.slice(row.id.indexOf('/') + 1);
  return {
    source: row.source_name, external: row.external === true,
    notice: { id: row.id, source_id: row.source_id, article_no: article, title: row.title, category: row.category, url: row.url,
      posted_on: row.posted_on, pinned: false, deadline: row.deadline, first_seen: null },
    body: { version: 1, id: row.id, summary: null, body: row.body, body_html: row.body_html, body_status: 'ready',
      attachments: [], images: [], body_from_image: false, fetched_at: new Date().toISOString() },
  };
}

/** 공지 한 건. 없거나 만료되면 null, 통신 오류는 던진다. get_public_notice 하나만 쓴다(표·목록은 읽지 않는다). */
export async function loadPublicNotice(client: SupabaseClient, id: string): Promise<PublicNotice | null> {
  if (!isNoticeId(id)) return null;
  const { data, error } = await client.rpc('get_public_notice', { p_id: id });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as PublicRow | undefined;
  return row ? publicRowToNotice(row) : null;
}
