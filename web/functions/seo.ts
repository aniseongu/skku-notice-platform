import { escapeHtml, isNoticeId, injectMeta, type ShareNotice } from './share-meta.ts';
import { SOLID_BUTTON, NOTE_TEXT } from '../src/cls.ts';

export const SITE_URL = 'https://skku-notice-platform.pages.dev';
export const SITE_DESCRIPTION = '성균관대 공지와 인턴 공고를 한곳에서 보고 새 소식과 마감 알림을 받아요';
export interface PublicEnv { SUPABASE_URL?: string; SUPABASE_PUBLISHABLE_KEY?: string }
export interface CacheContext { request: Request; waitUntil?: (promise: Promise<unknown>) => void }

export const noticeUrl = (id: string): string => `${SITE_URL}/?notice=${encodeURIComponent(id)}`;
export const jsonLd = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

export function cacheFor(request: Request): string {
  return new URL(request.url).origin === SITE_URL ? 'index, follow' : 'noindex, follow';
}

export async function rpc(env: PublicEnv, name: string, body: object): Promise<unknown> {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw new Error('Public database is unavailable');
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error('Public database request failed');
  return response.json();
}

// Only callers constructing a public, normalized key may use this helper. Never pass cookies or user responses.
export async function publicCache(context: CacheContext, keyUrl: string, create: () => Promise<Response>): Promise<Response> {
  const cache = (globalThis.caches as (CacheStorage & { default?: Cache }) | undefined)?.default;
  const key = new Request(keyUrl);
  try { const found = await cache?.match(key); if (found) return found; } catch { /* Cache failure must not break public pages. */ }
  const response = await create();
  if (cache && response.ok && !response.headers.has('set-cookie')) {
    const write = cache.put(key, response.clone()).catch(() => undefined);
    if (context.waitUntil) context.waitUntil(write); else await write;
  }
  return response;
}

export interface SitemapPage { pages: number; notices: { id: string; lastmod: string }[] }
export function parseSitemapPage(data: unknown): SitemapPage {
  const page = data as SitemapPage;
  if (!page || !Number.isInteger(page.pages) || page.pages < 1 || page.pages > 50000 || !Array.isArray(page.notices) || page.notices.length > 1000) throw new Error('Invalid sitemap data');
  for (const n of page.notices) {
    if (!n || !isNoticeId(n.id) || typeof n.lastmod !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/.test(n.lastmod) || !Number.isFinite(Date.parse(n.lastmod))) throw new Error('Invalid sitemap entry');
  }
  return page;
}

export function sitemapXml(page: SitemapPage, index: boolean, pageNumber: number): string {
  const prefix = '<?xml version="1.0" encoding="UTF-8"?>\n';
  if (index && page.pages > 1) {
    return prefix + '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      Array.from({ length: page.pages }, (_, i) => `<sitemap><loc>${SITE_URL}/sitemap.xml?page=${i}</loc></sitemap>`).join('') + '</sitemapindex>';
  }
  return prefix + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    (pageNumber === 0 ? `<url><loc>${SITE_URL}/</loc></url>` : '') + page.notices.map(n =>
      `<url><loc>${escapeHtml(noticeUrl(n.id))}</loc><lastmod>${n.lastmod.length === 10 ? n.lastmod : new Date(n.lastmod).toISOString()}</lastmod></url>`).join('') + '</urlset>';
}

function withHead(html: string, tags: string): string {
  // This block is replaced as a unit so a notice never inherits the homepage canonical/graph.
  return html.replace(/<!-- public-seo -->[\s\S]*?<!-- \/public-seo -->/g, '').replace('</head>', `${tags}\n</head>`);
}

export function renderPublicContent(html: string, notice?: ShareNotice, id?: string): string {
  if (!html.includes('</head>')) return html;
  const pageUrl = notice && id ? noticeUrl(id) : `${SITE_URL}/`;
  const structured = notice ? {
    '@context': 'https://schema.org', '@type': 'Article', headline: notice.title,
    description: notice.source_name, url: pageUrl, mainEntityOfPage: pageUrl, inLanguage: 'ko',
    ...(notice.posted_on && /^\d{4}-\d{2}-\d{2}$/.test(notice.posted_on) ? { datePublished: notice.posted_on } : {}),
  } : { '@context': 'https://schema.org', '@type': 'WebSite', name: '성공', url: pageUrl, description: SITE_DESCRIPTION, inLanguage: 'ko' };
  const tags = `<!-- public-seo -->
  <link rel="canonical" href="${escapeHtml(pageUrl)}">
  <link rel="alternate" type="application/rss+xml" title="성공 새 공지" href="${SITE_URL}/rss.xml">
  ${notice ? '' : `<meta property="og:type" content="website"><meta property="og:title" content="성공 · 성균관대 공지와 인턴 알림"><meta property="og:description" content="${SITE_DESCRIPTION}"><meta property="og:url" content="${pageUrl}"><meta property="og:site_name" content="성공">`}
  <script type="application/ld+json">${jsonLd(structured)}</script>
  <!-- /public-seo -->`;
  let out = withHead(notice ? injectMeta(html, notice, pageUrl) : html, tags);
  const title = notice?.title ?? '성균관대 공지와 인턴 알림, 성공';
  const text = notice?.body ?? (notice ? '' : SITE_DESCRIPTION);
  const source = notice ? `<p class="${NOTE_TEXT}">${escapeHtml(notice.source_name)}${notice.posted_on ? ` · ${escapeHtml(notice.posted_on)}` : ''}</p>` : '';
  const link = notice?.url ? `<a class="${SOLID_BUTTON} inline-flex items-center justify-center no-underline" href="${escapeHtml(notice.url)}" target="_blank" rel="noopener noreferrer">원문 보기</a>` : '';
  const content = `<notice-app><main class="mx-auto min-h-dvh max-w-[760px] px-[20px] py-[32px] text-ink"><article class="flex flex-col items-start gap-[16px]">${source}<h1 class="m-0 w-full whitespace-normal text-[22px] leading-[32px] [overflow-wrap:anywhere]">${escapeHtml(title)}</h1><div class="w-full whitespace-pre-wrap text-[15px] leading-[26px] [overflow-wrap:anywhere]">${escapeHtml(text)}</div>${link}<noscript><p class="${NOTE_TEXT}">로그인과 알림 설정은 자바스크립트를 켜면 이용할 수 있어요</p></noscript></article></main></notice-app>`;
  out = out.replace('<div id="app"></div>', () => `<div id="app">${content}</div>`);
  return out;
}
