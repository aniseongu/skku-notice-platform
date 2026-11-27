import { fetchNotice, isNoticeId } from './share-meta.ts';
import { cacheFor, publicCache, renderPublicContent, type PublicEnv, type CacheContext } from './seo.ts';

interface Env extends PublicEnv { ASSETS: { fetch(req: Request): Promise<Response> } }
type Context = CacheContext & { env: Env };

export async function onRequestGet(context: Context): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const original = await env.ASSETS.fetch(request);
  if (!original.ok || !original.headers.get('content-type')?.includes('text/html')) return original;
  const id = url.searchParams.get('notice');
  const isPrivate = [...url.searchParams.keys()].some(k => /^(view|section|code|access_token|refresh_token|error|error_description)$/.test(k)) || url.searchParams.get('tab') === 'saved';
  if (isPrivate || url.searchParams.get('push') === '1') {
    const headers = new Headers(original.headers);
    headers.set('x-robots-tag', 'noindex, follow'); headers.set('cache-control', 'private, no-store');
    return new Response(original.body, { status: original.status, headers });
  }
  const respond = async (): Promise<Response> => {
    const headers = new Headers(original.headers);
    headers.delete('content-length'); headers.delete('content-encoding'); headers.delete('etag'); headers.delete('set-cookie');
    headers.set('x-robots-tag', cacheFor(request));
    headers.set('cache-control', 'public, max-age=300');
    try {
      if (!url.searchParams.has('notice')) return new Response(renderPublicContent(await original.clone().text()), { headers });
      if (!isNoticeId(id)) { headers.set('x-robots-tag', 'noindex'); headers.set('cache-control', 'no-store'); return new Response(original.body, { status: 404, headers }); }
      // Development without a configured public backend keeps the existing app flow.
      if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return original;
      const notice = await fetchNotice(id, env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY);
      if (!notice) { headers.set('x-robots-tag', 'noindex'); headers.set('cache-control', 'no-store'); return new Response(original.body, { status: 404, headers }); }
      return new Response(renderPublicContent(await original.clone().text(), notice, id), { headers });
    } catch {
      headers.set('cache-control', 'no-store'); headers.set('retry-after', '60'); headers.set('x-robots-tag', 'noindex');
      return new Response(original.body, { status: 503, headers });
    }
  };
  // Only public responses enter this cache. Tracking values are dropped from the normalized key.
  const keyUrl = new URL(`${url.origin}/`);
  if (isNoticeId(id)) keyUrl.searchParams.set('notice', id);
  keyUrl.searchParams.set('__public_html', `head-safe-1:${original.headers.get('etag') ?? 'seo-20261127'}`);
  if (url.searchParams.has('notice') && !isNoticeId(id)) return respond();
  return publicCache(context, keyUrl.href, respond);
}

export async function onRequestHead(context: Context): Promise<Response> {
  // ASSETS has no body for HEAD. Render/cache a GET representation, then omit its body.
  const response = await onRequestGet({ ...context, request: new Request(context.request, { method: 'GET' }) });
  return new Response(null, { status: response.status, headers: response.headers });
}
