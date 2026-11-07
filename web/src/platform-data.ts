import type { SupabaseClient } from '@supabase/supabase-js';
import type { NoticeBody, NoticesFile } from './data';

// Public data only. User preferences and private responses never enter the offline cache.
export async function loadPublicFeed(client: SupabaseClient): Promise<NoticesFile | null> {
  const [sourceResult, noticeResult] = await Promise.all([
    client.from('platform_sources').select('id,name,url,last_success_at').order('id'),
    client.from('platform_notices')
      .select('id,source_id,article_no,title,category,url,posted_on,pinned,deadline,first_seen,changed_at,change_kind,previous_title')
      .order('posted_on', { ascending: false }).limit(1000),
  ]);
  if (sourceResult.error || noticeResult.error || !sourceResult.data?.length || !noticeResult.data?.length) return null;
  const successes = sourceResult.data.map((source) => source.last_success_at).filter((v): v is string => Boolean(v));
  if (!successes.length) return null;
  // The oldest successful source prevents a failing board from looking freshly updated.
  const generatedAt = successes.reduce((a, b) => Date.parse(a) < Date.parse(b) ? a : b);
  return { version: 1, generated_at: generatedAt,
    sources: sourceResult.data.map(({ id, name, url }) => ({ id, name, url })), notices: noticeResult.data };
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
