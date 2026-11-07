import type { SupabaseClient } from '@supabase/supabase-js';
import type { Judgement } from './data.ts';

/** 내 키로 매긴 판정을 원본의 판정 모양(Judgement)으로 바꾼다. 목록 줄과 상세가 같은 코드로 그린다. */
export interface MyJudgment { verdict: 'relevant' | 'maybe' | 'not_relevant'; reason: string; model: string; deadline: string | null; deadlineKind: '마감' | '일정' | null }

const VERDICTS = new Set(['relevant', 'maybe', 'not_relevant']);

export function asJudgement(mine: MyJudgment): Judgement {
  return { rule_name: null, priority: null, reasons: [], interests: [], ai: { verdict: mine.verdict, reason: mine.reason, model: mine.model }, notified: false };
}

/** 내가 매긴 모든 판정(본인 행만 읽힌다). 최근 것부터 최대 1000개. */
export async function loadMyJudgments(client: SupabaseClient, userId: string): Promise<Map<string, MyJudgment>> {
  const { data, error } = await client.from('user_notice_judgments')
    .select('notice_id,verdict,reason,model,deadline,deadline_kind').eq('user_id', userId).order('created_at', { ascending: false }).limit(1000);
  if (error) throw error;
  const map = new Map<string, MyJudgment>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    if (typeof row.notice_id !== 'string' || typeof row.verdict !== 'string' || !VERDICTS.has(row.verdict) || typeof row.reason !== 'string' || !row.reason.trim()) continue;
    map.set(row.notice_id, {
      verdict: row.verdict as MyJudgment['verdict'], reason: row.reason, model: typeof row.model === 'string' ? row.model : '',
      deadline: typeof row.deadline === 'string' ? row.deadline : null,
      deadlineKind: row.deadline_kind === '마감' || row.deadline_kind === '일정' ? row.deadline_kind : null,
    });
  }
  return map;
}

/** 내 관심 키워드가 제목·본문·그림 속 글자에 있는 공지(서버가 찾아 준다). 공지 번호 → 맞은 키워드 */
export async function loadMyInterests(client: SupabaseClient): Promise<Map<string, string[]>> {
  const { data, error } = await client.rpc('my_notice_interests', { p_limit: 300 });
  if (error) throw error;
  const map = new Map<string, string[]>();
  for (const row of (data ?? []) as { notice_id?: unknown; words?: unknown }[]) {
    if (typeof row.notice_id === 'string' && Array.isArray(row.words)) map.set(row.notice_id, row.words.filter((w): w is string => typeof w === 'string'));
  }
  return map;
}
