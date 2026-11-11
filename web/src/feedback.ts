// 앱 안 문의: 로그인한 계정이 짧은 글을 보낸다. 저장은 user_feedback 표(삽입 전용, 읽기는 운영자만).
import type { SupabaseClient } from '@supabase/supabase-js';

export type FeedbackKind = 'question' | 'bug' | 'idea';
export const FEEDBACK_KINDS: readonly (readonly [FeedbackKind, string])[] = [['question', '문의'], ['bug', '버그'], ['idea', '바라는 점']];
export const FEEDBACK_LIMIT = 500;
export type FeedbackResult = 'ok' | 'limit' | 'error';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** 보내기 전에 화면에서 거르는 규칙. 서버 표의 검사와 같은 기준이다. */
export function feedbackProblem(body: string, email: string): string | null {
  if (!body.trim()) return '내용을 적어 주세요';
  if (body.length > FEEDBACK_LIMIT) return `${FEEDBACK_LIMIT}자 이하로 적어 주세요`;
  const mail = email.trim();
  if (mail && (mail.length > 254 || !EMAIL.test(mail))) return '메일 주소를 다시 확인해 주세요';
  return null;
}

export async function sendFeedback(client: SupabaseClient | null, kind: FeedbackKind, body: string, email: string): Promise<FeedbackResult> {
  if (!client || feedbackProblem(body, email)) return 'error';
  const { error } = await client.from('user_feedback').insert({ kind, body: body.trim(), reply_email: email.trim() || null });
  if (!error) return 'ok';
  return /feedback_limit/.test(`${error.message} ${error.details ?? ''}`) ? 'limit' : 'error';
}
