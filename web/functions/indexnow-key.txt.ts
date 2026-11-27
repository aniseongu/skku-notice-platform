// Public ownership proof required by IndexNow. The deployment secret never enters source control.
export function onRequestGet(context: { env: { INDEXNOW_KEY?: string } }): Response {
  const key = context.env.INDEXNOW_KEY;
  if (!key || !/^[a-f0-9-]{8,128}$/i.test(key)) return new Response('Unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
  return new Response(key, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-robots-tag': 'noindex' } });
}

export function onRequestHead(context: { env: { INDEXNOW_KEY?: string } }): Response {
  const response = onRequestGet(context);
  return new Response(null, { status: response.status, headers: response.headers });
}
