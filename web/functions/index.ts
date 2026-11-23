// 루트 주소(`/?notice=<id>`)만 처리한다. 공유 미리보기 봇이 공지 제목·게시판을 보게 메타를 넣는다.
// 런타임 환경변수 SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY(공개 키)가 Pages 프로젝트에 있어야 한다. 없거나 실패하면 원본 HTML 그대로.
import { fetchNotice, injectMeta, isNoticeId } from './share-meta.ts';

interface Env { ASSETS: { fetch(req: Request): Promise<Response> }; SUPABASE_URL?: string; SUPABASE_PUBLISHABLE_KEY?: string }

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  const original = await env.ASSETS.fetch(request);
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('notice');
    const type = original.headers.get('content-type') ?? '';
    if (url.searchParams.get('push') === '1' || !isNoticeId(id) || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !original.ok || !type.includes('text/html')) return original;
    const notice = await fetchNotice(id, env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY);
    if (!notice) return original;
    const html = injectMeta(await original.clone().text(), notice, `${url.origin}/?notice=${encodeURIComponent(id)}`);
    const headers = new Headers(original.headers);
    headers.delete('content-length');
    headers.delete('etag');
    headers.set('cache-control', 'public, max-age=300');
    return new Response(html, { status: 200, headers });
  } catch {
    return original;
  }
};
