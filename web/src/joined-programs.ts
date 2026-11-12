// 사용자가 직접 "참여 중"이라고 알려 주는 사업(부트캠프, 사업단)과 융합·연계전공. 참여 학생만 신청할 수 있는 공지를 AI가 가릴 때 쓴다.
// 서버 판정 워커(src/skku_notice/byok_judge.py)의 JOINED_PROGRAM_LABELS와 id·이름을 같게 둔다.
// 융합·연계전공은 소속 대학을 학교 자료로 확인하지 못해 복수전공 목록(skku-programs.ts)에 넣지 않고 여기서 묻는다.
/** boardId: 이 사업의 공지 게시판. 첫 설정에서 그 게시판을 켜면 바로 아래에서 참여 여부를 묻는다. ask: 그때 묻는 말. */
export interface JoinedProgram { id: string; label: string; group: string; ask: string; boardId?: string }

export const JOINED_PROGRAMS: readonly JoinedProgram[] = [
  { id: 'futurecar', label: '미래차 부트캠프', group: '부트캠프', ask: '참여 중이에요', boardId: 'futurecar-notice' },
  { id: 'ai-bootcamp', label: '인공지능 부트캠프', group: '부트캠프', ask: '참여 중이에요' },
  { id: 'display-bootcamp', label: '디스플레이 부트캠프', group: '부트캠프', ask: '참여 중이에요' },
  { id: 'aiuniv', label: 'AI중심대학사업단', group: '사업단', ask: '참여 중이에요', boardId: 'aiuniv-notice' },
  { id: 'fabtech', label: '지능형팹테크융합전공', group: '융합·연계전공', ask: '하고 있어요', boardId: 'fabtech-notice' },
  { id: 'ase', label: '차세대반도체공학연계전공', group: '융합·연계전공', ask: '하고 있어요', boardId: 'ase-notice' },
];

const KNOWN = new Set(JOINED_PROGRAMS.map((program) => program.id));

/** 저장된 값을 믿지 않고 목록에 있는 것만 남긴다. */
export function parseJoinedPrograms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && KNOWN.has(id)))];
}
