import { cacheFor, parseSitemapPage, publicCache, rpc, sitemapXml, type PublicEnv, type CacheContext } from './seo.ts';

export async function onRequestGet(context: CacheContext & { env: PublicEnv }): Promise<Response> {
  const url = new URL(context.request.url);
  const value = url.searchParams.get('page');
  if (value !== null && (!/^(0|[1-9]\d{0,4})$/.test(value) || Number(value) >= 50000)) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
  const pageNumber = value === null ? 0 : Number(value);
  const key = `${url.origin}/sitemap.xml${value === null ? '' : `?page=${pageNumber}`}`;
  return publicCache(context, key, async () => {
    try {
      const page = parseSitemapPage(await rpc(context.env, 'get_public_sitemap', { p_page: pageNumber }));
      if (pageNumber >= page.pages) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
      return new Response(sitemapXml(page, value === null, pageNumber), { headers: {
        'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600',
        'x-robots-tag': cacheFor(context.request), 'x-content-type-options': 'nosniff',
      } });
    } catch {
      return new Response('Sitemap temporarily unavailable', { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '60', 'x-robots-tag': 'noindex' } });
    }
  });
}

export async function onRequestHead(context: CacheContext & { env: PublicEnv }): Promise<Response> {
  const response = await onRequestGet(context);
  return new Response(null, { status: response.status, headers: response.headers });
}
