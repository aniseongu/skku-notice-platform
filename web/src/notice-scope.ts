// 공지가 속한 보기와 기한 규칙. 의존성이 없어 단위 시험이 바로 불러온다.
interface ScopeSource { external?: boolean; coop?: boolean }
interface ScopeNotice { deadline: string | null; expires_at?: string | null }

/** 일시 중지한 게시판(config/sources.yaml의 paused: true와 같게 둔다). 서버는 수집하지 않고 화면은 목록·게시판 고르기·기준 시각에서 뺀다.
 * 저장해 둔 공지는 저장 탭에 그대로 남는다. 자소설닷컴은 2026-11-23부터 자동 접근을 막아 2026-11-24에 멈췄다(사용자 결정). */
export const PAUSED_SOURCES: ReadonlySet<string> = new Set(['jasoseol-intern']);

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
