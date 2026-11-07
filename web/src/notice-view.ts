import type { MyNoticeInfo } from './byok.ts';
import type { Notice, NoticeBody } from './data.ts';

/** 제목에 날짜가 없으면 내 Gemini가 본문에서 읽은 마감을 보인다. 공유 데이터는 그대로 두고 내 화면에만 반영한다. */
export function withMyDeadline<T extends Pick<Notice, 'deadline'> & { deadline_kind?: Notice['deadline_kind'] }>(notice: T, mine: Pick<MyNoticeInfo, 'deadline' | 'deadlineKind'> | null): T {
  if (notice.deadline || !mine?.deadline) return notice;
  return { ...notice, deadline: mine.deadline, deadline_kind: mine.deadlineKind ?? notice.deadline_kind };
}

/** 본문과 그림 속 글자에서 찾은 관심 키워드(글자가 그대로 있을 때만). 원본은 서버가 찾아 알려 줬다. */
export function bodyInterests(
  keywords: readonly string[], body: NoticeBody | null | 'loading', matches: (keyword: string, text: string) => boolean,
): string[] {
  if (!body || body === 'loading') return [];
  const text = `${body.body ?? ''} ${(body.ocr_text ?? []).join(' ')}`;
  return keywords.filter((word) => matches(word, text));
}
