// 목록 줄과 상세가 같이 쓰는 판정 문구("관심 인턴", "확인 필요" 등). 읽은 글(read)은 색 없이 회색으로 연하게 한다.
import { VERDICT_LABEL, type Verdict } from './data';

const LABEL = 'mr-[6px]';
const BOLD = `${LABEL} font-semibold`;
// 읽은 글: 모든 라벨이 같은 회색, 굵기 500.
const READ = `${LABEL} font-medium text-ink-2`;

export function Reason({ interests, ai, rule, read = false }: {
  interests: string[]; ai: { verdict: Verdict; reason: string } | null; rule: string | null; read?: boolean;
}) {
  if (interests.length) {
    return <span className="reason"><b className={`interest ${read ? READ : `${BOLD} text-accent`}`}>관심 {interests.join(', ')}</b>{ai && ai.verdict !== 'not_relevant' ? ai.reason : ''}</span>;
  }
  if (ai) {
    const tone = ai.verdict === 'relevant' ? 'text-accent' : ai.verdict === 'maybe' ? 'text-soon' : '';
    return <span className={`reason ${ai.verdict} ${ai.verdict === 'not_relevant' ? 'text-ink-3' : ''}`}><b className={read ? READ : `${BOLD} ${tone}`}>{VERDICT_LABEL[ai.verdict]}</b>{ai.reason}</span>;
  }
  return rule ? <span className="reason rule"><b className={read ? READ : `${BOLD} text-ink-2`}>기준</b>{rule}</span> : null;
}
