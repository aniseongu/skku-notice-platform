import { escapeHtml, isNoticeId } from './share-meta.ts';
import { cacheFor, noticeUrl, publicCache, rpc, SITE_URL, SITE_DESCRIPTION, type PublicEnv, type CacheContext } from './seo.ts';

interface Entry { id: string; title: string; source_name: string; posted_on: string; changed_at: string | null }
const xmlText = (value: string): string => escapeHtml(value.replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, ''));
export function feedXml(data: unknown): string {
  if (!Array.isArray(data) || data.length > 50) throw new Error('Invalid public feed');
  const entries = data as Entry[];
  for (const n of entries) if (!n || !isNoticeId(n.id) || typeof n.title !== 'string' || typeof n.source_name !== 'string' || !Number.isFinite(Date.parse(n.changed_at ?? n.posted_on))) throw new Error('Invalid feed entry');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>' +
    `<title>성공 새 공지</title><link>${SITE_URL}/</link><description>${SITE_DESCRIPTION}</description><language>ko</language>` +
    `<atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml"/>` + entries.map(n =>
      `<item><title>${xmlText(n.title)}</title><link>${noticeUrl(n.id)}</link><guid isPermaLink="true">${noticeUrl(n.id)}</guid><description>${xmlText(n.source_name)}</description><pubDate>${new Date(n.changed_at ?? `${n.posted_on}T00:00:00+09:00`).toUTCString()}</pubDate></item>`).join('') + '</channel></rss>';
}

export async function onRequestGet(context: CacheContext & { env: PublicEnv }): Promise<Response> {
  return publicCache(context, `${new URL(context.request.url).origin}/rss.xml`, async () => {
    try {
      return new Response(feedXml(await rpc(context.env, 'get_public_notice_feed', {})), { headers: {
        'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=600', 'x-robots-tag': cacheFor(context.request), 'x-content-type-options': 'nosniff',
      } });
    } catch {
      return new Response('Feed temporarily unavailable', { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '60', 'x-robots-tag': 'noindex' } });
    }
  });
}

export async function onRequestHead(context: CacheContext & { env: PublicEnv }): Promise<Response> {
  const response = await onRequestGet(context);
  return new Response(null, { status: response.status, headers: response.headers });
}
