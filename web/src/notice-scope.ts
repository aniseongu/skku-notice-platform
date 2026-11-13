// 공지가 속한 보기와 기한 규칙. 의존성이 없어 단위 시험이 바로 불러온다.
interface ScopeSource { external?: boolean; coop?: boolean }
interface ScopeNotice { deadline: string | null; expires_at?: string | null }

/** 공지가 어느 보기에 속하는지: 현장실습 > 인턴 공고(외부) > 성대 공지. */
export type NoticeKind = 'all' | 'intern' | 'coop';
export function noticeKind(source: ScopeSource | undefined): NoticeKind {
  return source?.coop ? 'coop' : source?.external ? 'intern' : 'all';
}

/** 기한이 지나 어느 목록에도 보이지 않을 공지(검색과 저장 포함). 서버가 곧 지운다. 현장실습은 접수마감이 지나도 숨긴다. */
export function isExpired(notice: ScopeNotice, source: ScopeSource | undefined, now = Date.now()): boolean {
  if (notice.expires_at && new Date(notice.expires_at).getTime() < now) return true;
  return source?.coop === true && !!notice.deadline && new Date(notice.deadline).getTime() < now;
}
