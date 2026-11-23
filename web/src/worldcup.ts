// 공지 월드컵: 후보 고르기와 대진 진행(순수 함수). 서버에 기록하지 않고 화면 안에서만 쓴다.
// 설계는 docs/design/2026-11-23_notice-worldcup.md.
export interface CupNotice { id: string; title: string; board: string; deadline: string | null; saved: boolean }

export const CUP_SIZES = [16, 8] as const;
/** 후보가 이보다 적으면 진입 줄을 숨긴다. */
export const CUP_MIN = 8;

/** 저장한 공지를 먼저, 모자라면 최근 공지로 채운다. 같은 공지(id)는 한 번만, 마감이 지난 것은 뺀다. 16·8개에 못 미치면 8개 단위로 내려가고 8개 미만이면 빈 배열. */
export function pickCandidates(saved: readonly CupNotice[], recent: readonly CupNotice[], now = Date.now()): CupNotice[] {
  const seen = new Set<string>();
  const pool: CupNotice[] = [];
  for (const item of [...saved, ...recent]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (item.deadline && new Date(item.deadline).getTime() < now) continue;
    pool.push(item);
  }
  const size = CUP_SIZES.find((n) => pool.length >= n);
  return size ? pool.slice(0, size) : [];
}

export interface Cup {
  /** 이번 라운드에서 겨룰 공지(짝수 개). */
  round: CupNotice[];
  /** 이번 라운드 승자들. */
  winners: CupNotice[];
  /** 이번 라운드에서 지금 몇 번째 대결인지(0부터). */
  match: number;
  champion: CupNotice | null;
}

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export function startCup(candidates: readonly CupNotice[], random: () => number = Math.random): Cup {
  return { round: shuffle(candidates, random), winners: [], match: 0, champion: null };
}

export const currentPair = (cup: Cup): [CupNotice, CupNotice] | null =>
  cup.champion ? null : [cup.round[cup.match * 2], cup.round[cup.match * 2 + 1]];

/** side 0이면 왼쪽(위), 1이면 오른쪽(아래) 공지가 이긴다. */
export function pick(cup: Cup, side: 0 | 1): Cup {
  const pair = currentPair(cup);
  if (!pair) return cup;
  const winners = [...cup.winners, pair[side]];
  const match = cup.match + 1;
  if (match < cup.round.length / 2) return { ...cup, winners, match };
  if (winners.length === 1) return { round: [], winners: [], match: 0, champion: winners[0] };
  return { round: winners, winners: [], match: 0, champion: null };
}

/** "8강", "4강", "결승" */
export function roundName(roundSize: number): string { return roundSize <= 2 ? '결승' : `${roundSize}강`; }

/** "8강 2/4" */
export function progressLabel(cup: Cup): string {
  return `${roundName(cup.round.length)} ${cup.match + 1}/${cup.round.length / 2}`;
}
