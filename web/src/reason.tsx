// 목록 줄과 상세가 같이 쓰는 판정 문구("관심 인턴", "졸업요건 충족", "확인 필요" 등).
// 읽은 글(read)은 색을 바꾸지 않고 연하게만 한다(회색으로 바뀌면 무슨 판정이었는지 알 수 없다).
import { VERDICT_LABEL, type Verdict } from './data';
import { BADGE_LABEL, type GraduationBadge } from './graduation-assessment';

const LABEL = 'mr-[6px]';
const strong = (read: boolean, color: string) => `${LABEL} ${read ? `font-medium ${color}/60` : `font-semibold ${color}`}`;
const BADGE_COLOR: Record<GraduationBadge, string> = { ok: 'text-accent', review: 'text-soon', no: 'text-ink-3' };

export function Reason({ interests, ai, rule, read = false, grad = null, detail = false }: {
  interests: string[]; ai: { verdict: Verdict; reason: string } | null; rule: string | null; read?: boolean; grad?: GraduationBadge | null; detail?: boolean;
}) {
  const badge = grad ? <b className={`grad-badge ${grad === 'no' ? `${LABEL} font-normal ${BADGE_COLOR.no}` : strong(read, BADGE_COLOR[grad])}`}>{detail && grad === 'review' ? '졸업요건 확인 필요' : BADGE_LABEL[grad]}</b> : null;
  if (interests.length) {
    return <span className="reason"><b className={`interest ${strong(read, 'text-accent')}`}>관심 {interests.join(', ')}</b>{badge}{ai && ai.verdict !== 'not_relevant' ? ai.reason : ''}</span>;
  }
  if (ai) {
    // 해당 없음은 가장 연하게: 굵지 않고 흐린 회색. 읽었는지와 관계없이 같다.
    if (ai.verdict === 'not_relevant') return <span className="reason not_relevant text-ink-3">{badge}<b className={`${LABEL} font-normal`}>{VERDICT_LABEL[ai.verdict]}</b>{ai.reason}</span>;
    const tone = ai.verdict === 'relevant' ? 'text-accent' : 'text-soon';
    return <span className={`reason ${ai.verdict}`}><b className={strong(read, tone)}>{VERDICT_LABEL[ai.verdict]}</b>{badge}{ai.reason}</span>;
  }
  if (rule) return <span className="reason rule"><b className={strong(read, 'text-ink-2')}>기준</b>{badge}{rule}</span>;
  return badge ? <span className="reason grad">{badge}</span> : null;
}
