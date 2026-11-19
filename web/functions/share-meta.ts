// 공유 링크 미리보기용 메타 삽입. Pages Functions(functions/index.ts)가 쓴다. 규칙은 스킬 share-deeplink-preview.
// 이 파일은 onRequest*를 내보내지 않으므로 라우트가 되지 않는다.

export interface ShareNotice { title: string; source_name: string; deadline: string | null }

export function isNoticeId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200 && /^[a-z0-9-]+\/[0-9]+$/.test(value);
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function clip(text: string, max: number): string {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}

/** 게시판과 마감만. 본문은 넣지 않는다. */
export function describe(n: ShareNotice): string {
  const m = n.deadline && /^(\d{4})-(\d{2})-(\d{2})/.exec(n.deadline);
  const due = m ? ` · 마감 ${Number(m[2])}월 ${Number(m[3])}일` : '';
  return clip(`${n.source_name}${due}`, 100);
}

export function buildMetaTags(n: ShareNotice, pageUrl: string): string {
  const title = escapeHtml(clip(n.title, 100));
  const desc = escapeHtml(describe(n));
  const url = escapeHtml(pageUrl);
  return [
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="성공">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${desc}">`,
  ].join('\n  ');
}

/** 기본 description·title을 공지 것으로 바꾸고 </head> 앞에 og 태그를 넣는다. 형태가 다르면 원본 그대로. */
export function injectMeta(html: string, n: ShareNotice, pageUrl: string): string {
  if (!html.includes('</head>')) return html;
  const title = escapeHtml(clip(n.title, 100));
  const desc = escapeHtml(describe(n));
  const out = html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${desc}">`);
  return out.replace('</head>', () => `  ${buildMetaTags(n, pageUrl)}\n</head>`);
}

export async function fetchNotice(id: string, supabaseUrl: string, key: string, fetcher: typeof fetch = fetch): Promise<ShareNotice | null> {
  const res = await fetcher(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/get_public_notice`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_id: id }),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) return null;
  const data = await res.json() as unknown;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row || typeof row.title !== 'string' || typeof row.source_name !== 'string') return null;
  return { title: row.title, source_name: row.source_name, deadline: typeof row.deadline === 'string' ? row.deadline : null };
}
