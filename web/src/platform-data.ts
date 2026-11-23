import type { SupabaseClient } from '@supabase/supabase-js';
import type { Notice, NoticeBody, NoticesFile } from './data';

// 로그인한 사용자만 읽는다(공지 표는 authenticated 전용). 개인 설정과 개인 응답은 오프라인 캐시에 넣지 않는다.
const NOTICE_COLUMNS = 'id,source_id,article_no,title,category,url,posted_on,pinned,deadline,first_seen,changed_at,change_kind,previous_title,dup_key,dup_text_key';

export async function loadPublicFeed(client: SupabaseClient): Promise<NoticesFile | null> {
  // external, coop 컬럼이 아직 없는 데이터베이스에서도 피드가 깨지지 않게 한 칸씩 줄여 다시 읽는다.
  const readSources = async () => {
    const read = (columns: string) => client.from('platform_sources').select(columns).order('id');
    for (const columns of ['id,name,url,last_success_at,external,coop,shared_board', 'id,name,url,last_success_at,external,coop', 'id,name,url,last_success_at,external']) {
      const result = await read(columns);
      if (!result.error) return result;
    }
    return read('id,name,url,last_success_at');
  };
  // expires_at 컬럼이 없는 데이터베이스에서는 빼고 다시 읽는다.
  const readNotices = async () => {
    // 같은 날짜 안의 순서를 원본(alert)처럼 (게시일, 처음 본 시각, 번호) 내림차순으로 고정한다. 정렬은 게시일만 보므로 이 입력 순서가 그대로 남는다.
    const read = (columns: string) => client.from('platform_notices').select(columns)
      .order('posted_on', { ascending: false }).order('first_seen', { ascending: false }).order('id', { ascending: false }).limit(1000);
    const withExpiry = await read(`${NOTICE_COLUMNS},expires_at`);
    return withExpiry.error ? read(NOTICE_COLUMNS) : withExpiry;
  };
  const [sourceResult, noticeResult] = await Promise.all([readSources(), readNotices()]);
  if (sourceResult.error || noticeResult.error || !sourceResult.data?.length || !noticeResult.data?.length) return null;
  const sourceRows = sourceResult.data as unknown as { id: string; name: string; url: string; last_success_at: string | null; external?: boolean; coop?: boolean; shared_board?: boolean }[];
  const successes = sourceRows.map((source) => source.last_success_at).filter((v): v is string => Boolean(v));
  if (!successes.length) return null;
  // The oldest successful source prevents a failing board from looking freshly updated.
  const generatedAt = successes.reduce((a, b) => Date.parse(a) < Date.parse(b) ? a : b);
  return { version: 1, generated_at: generatedAt,
    sources: sourceRows.map(({ id, name, url, external, coop, shared_board }) => ({ id, name, url, ...(external === true ? { external: true } : {}), ...(coop === true ? { coop: true } : {}), ...(shared_board === true ? { shared_board: true } : {}) })),
    notices: noticeResult.data as unknown as NoticesFile['notices'] };
}

/** 저장에만 남은 공지의 행을 받는다. 피드 범위와 구독 여부에 의존하지 않는다. */
export async function loadSavedNoticeDetails(client: SupabaseClient, ids: readonly string[], current: () => boolean): Promise<Notice[]> {
  const notices: Notice[] = [];
  for (let offset = 0; offset < ids.length; offset += 50) {
    if (!current()) throw new Error('계정이 바뀌었어요');
    const { data, error } = await client.from('platform_notices').select(`${NOTICE_COLUMNS},expires_at`)
      .in('id', ids.slice(offset, offset + 50));
    if (error) throw error;
    notices.push(...(data as Notice[] ?? []));
  }
  return notices;
}

export async function loadPublicBody(client: SupabaseClient, sourceId: string, articleNo: string, signal?: AbortSignal, existing?: NoticeBody): Promise<NoticeBody | null> {
  const id = `${sourceId}/${articleNo}`;
  // 신호가 있으면 쿼리 빌더에 달아 시간 초과나 계정 전환 때 요청 자체를 끊는다.
  const limited = <Q,>(query: Q): Q => (signal && typeof (query as { abortSignal?: unknown }).abortSignal === 'function'
    ? (query as unknown as { abortSignal(s: AbortSignal): Q }).abortSignal(signal) : query);
  const notices = client.from('platform_notices');
  // 단건 RPC의 원문은 즉시 표시했다. 첨부·이미지 정보만 읽어 덧붙인다.
  const query = existing
    ? notices.select('id,attachments,images,fetched_at')
    : notices.select('id,body,body_html,attachments,images,fetched_at');
  const [bodyResult, ocrResult] = await Promise.all([
    limited(query.eq('id', id)).maybeSingle(),
    Promise.resolve(limited(client.from('platform_notice_images').select('image_url,platform_ocr_cache(extracted_text)')
      .eq('notice_id', id).eq('status', 'ready')).limit(3)).catch(() => null),
  ]);
  const { error } = bodyResult;
  const data = bodyResult.data as Pick<NoticeBody, 'id' | 'attachments' | 'images' | 'fetched_at'>
    & Partial<Pick<NoticeBody, 'body' | 'body_html'>> | null;
  if (error || !data || !data.fetched_at) return existing ?? null;
  const rows = (ocrResult?.error ? [] : ocrResult?.data ?? []) as unknown as
    { image_url: string; platform_ocr_cache: { extracted_text?: unknown } | null }[];
  const images: unknown[] = Array.isArray(data.images) ? data.images : [];
  const ocrText = [...new Set(rows.filter((row) => images.includes(row.image_url))
    .map((row) => row.platform_ocr_cache?.extracted_text)
    .filter((text): text is string => typeof text === 'string' && !!text.trim())
    .map((text) => text.slice(0, 100_000)))];
  return { version: 1, id: data.id, summary: null, body: existing ? existing.body : data.body ?? null, body_html: existing ? existing.body_html : data.body_html,
    body_status: 'ready', attachments: data.attachments, images: data.images,
    body_from_image: false, ocr_text: ocrText, fetched_at: data.fetched_at };
}
