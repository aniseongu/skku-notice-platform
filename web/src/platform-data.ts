import type { SupabaseClient } from '@supabase/supabase-js';
import type { NoticeBody, NoticesFile } from './data';

// Public data only. User preferences and private responses never enter the offline cache.
export async function loadPublicFeed(client: SupabaseClient): Promise<NoticesFile | null> {
  // external 컬럼이 아직 없는 데이터베이스에서도 피드가 깨지지 않게 한 번 더 읽는다.
  const readSources = async () => {
    const withFlag = await client.from('platform_sources').select('id,name,url,last_success_at,external').order('id');
    if (!withFlag.error) return withFlag;
    return client.from('platform_sources').select('id,name,url,last_success_at').order('id');
  };
  // 같은 날짜 안의 순서를 원본(alert)처럼 (게시일, 처음 본 시각, 번호) 내림차순으로 고정한다. 정렬은 게시일만 보므로 이 입력 순서가 그대로 남는다.
  const [sourceResult, noticeResult] = await Promise.all([
    readSources(),
    client.from('platform_notices')
      .select('id,source_id,article_no,title,category,url,posted_on,pinned,deadline,first_seen,changed_at,change_kind,previous_title')
      .order('posted_on', { ascending: false }).order('first_seen', { ascending: false }).order('id', { ascending: false }).limit(1000),
  ]);
  if (sourceResult.error || noticeResult.error || !sourceResult.data?.length || !noticeResult.data?.length) return null;
  const sourceRows = sourceResult.data as { id: string; name: string; url: string; last_success_at: string | null; external?: boolean }[];
  const successes = sourceRows.map((source) => source.last_success_at).filter((v): v is string => Boolean(v));
  if (!successes.length) return null;
  // The oldest successful source prevents a failing board from looking freshly updated.
  const generatedAt = successes.reduce((a, b) => Date.parse(a) < Date.parse(b) ? a : b);
  return { version: 1, generated_at: generatedAt,
    sources: sourceRows.map(({ id, name, url, external }) => ({ id, name, url, ...(external === true ? { external: true } : {}) })),
    notices: noticeResult.data };
}

export async function loadPublicBody(client: SupabaseClient, sourceId: string, articleNo: string): Promise<NoticeBody | null> {
  const id = `${sourceId}/${articleNo}`;
  const [bodyResult, ocrResult] = await Promise.all([
    client.from('platform_notices').select('id,body,body_html,attachments,images,fetched_at').eq('id', id).maybeSingle(),
    Promise.resolve(client.from('platform_notice_images').select('image_url,platform_ocr_cache(extracted_text)')
      .eq('notice_id', id).eq('status', 'ready').limit(3)).catch(() => null),
  ]);
  const { data, error } = bodyResult;
  if (error || !data || !data.fetched_at) return null;
  const rows = (ocrResult?.error ? [] : ocrResult?.data ?? []) as unknown as
    { image_url: string; platform_ocr_cache: { extracted_text?: unknown } | null }[];
  const images: unknown[] = Array.isArray(data.images) ? data.images : [];
  const ocrText = [...new Set(rows.filter((row) => images.includes(row.image_url))
    .map((row) => row.platform_ocr_cache?.extracted_text)
    .filter((text): text is string => typeof text === 'string' && !!text.trim())
    .map((text) => text.slice(0, 100_000)))];
  return { version: 1, id: data.id, summary: null, body: data.body, body_html: data.body_html,
    body_status: 'ready', attachments: data.attachments, images: data.images,
    body_from_image: false, ocr_text: ocrText, fetched_at: data.fetched_at };
}
