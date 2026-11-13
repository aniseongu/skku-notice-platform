// 목록 줄과 상세가 같이 쓰는 판정 문구("관심 인턴", "졸업요건 충족", "확인 필요" 등).
// 읽은 글(read)은 색을 바꾸지 않고 연하게만 한다(회색으로 바뀌면 무슨 판정이었는지 알 수 없다).
import { VERDICT_LABEL, type Verdict } from './data';
import type { GradPart } from './graduation-assessment';

const LABEL = 'mr-[6px]';
/** 키워드와 이유 사이의 옅은 구분점. 낭독기가 읽지 않게 숨긴다. 이유가 있을 때만 그린다. */
const Dot = ({ show }: { show: boolean }) => (show ? <span aria-hidden className="mr-[6px] text-ink-3">·</span> : null);
// 읽은 글: 색은 그대로 두고 바탕 쪽으로 18%만 옅게 섞는다. Tailwind는 완성된 클래스 이름만 찾으므로 문자열을 이어 붙이지 않는다.
const FADED: Record<string, string> = {
  // 라이트는 95%만 섞는다(읽은 줄 면 위에서도 4.5:1을 지키려고). 읽은 글은 줄 면과 굵기로 구분된다. 다크는 82%.
  'text-accent': 'text-[light-dark(color-mix(in_oklch,var(--accent)_95%,var(--surface)),color-mix(in_oklch,var(--accent)_82%,var(--surface)))]',
  'text-soon': 'text-[color-mix(in_oklch,var(--soon)_82%,var(--surface))]',
  'text-ink-2': 'text-ink-2',
  'text-ink-3': 'text-ink-3',
};
const strong = (read: boolean, color: string) => `${LABEL} ${read ? `font-medium ${FADED[color]}` : `font-semibold ${color}`}`;

/** "3품 인턴십 충족, 솦 인턴십 미달" 한 묶음. 충족은 강조색, 미달은 연한 회색(글자로도 구분된다). 확인이 필요하다는 말은 영역마다 반복하지 않고 공지 상세에 한 번만 적는다. */
function GradParts({ parts, read }: { parts: GradPart[]; read: boolean }) {
  return <>{parts.map((part, index) => <b key={part.key} className={`grad-badge ${part.met ? strong(read, 'text-accent') : `${LABEL} font-normal text-ink-3`}`}>
    {part.name} {part.met ? '충족' : '미달'}{index < parts.length - 1 ? ',' : ''}</b>)}</>;
}

export function Reason({ interests, ai, rule, read = false, grad = [], pending = false }: {
  interests: string[]; ai: { verdict: Verdict; reason: string } | null; rule: string | null; read?: boolean; grad?: GradPart[]; pending?: boolean;
}) {
  const parts = grad.length ? <GradParts parts={grad} read={read} /> : null;
  const sentence = ai && ai.verdict !== 'not_relevant' ? ai.reason : '';
  if (interests.length) {
    return <span className="reason"><b className={`interest ${strong(read, 'text-accent')}`}>관심 {interests.join(', ')}</b>{parts}<Dot show={!!sentence} />{sentence}</span>;
  }
  // 졸업요건 결과가 있으면 그것이 "해당"의 구체적인 말이라 판정 이름을 따로 적지 않는다(한 묶음으로 적는다).
  if (parts) return <span className="reason grad">{parts}<Dot show={!!sentence} />{sentence}</span>;
  if (ai) {
    // 해당 없음은 가장 연하게: 굵지 않고 흐린 회색. 읽었는지와 관계없이 같다.
    if (ai.verdict === 'not_relevant') return <span className="reason not_relevant text-ink-3"><b className={`${LABEL} font-normal`}>{VERDICT_LABEL[ai.verdict]}</b><Dot show={!!ai.reason} />{ai.reason}</span>;
    const tone = ai.verdict === 'relevant' ? 'text-accent' : 'text-soon';
    return <span className={`reason ${ai.verdict}`}><b className={strong(read, tone)}>{VERDICT_LABEL[ai.verdict]}</b><Dot show={!!ai.reason} />{ai.reason}</span>;
  }
  // 판정 전: 해당 없음과 같은 연한 회색으로, 판단이 아니라 상태임을 분명히 한다.
  if (pending && !rule) return <span className="reason pending text-ink-3"><b className={`${LABEL} font-normal`}>AI가 확인하고 있어요</b></span>;
  return rule ? <span className="reason rule"><b className={strong(read, 'text-ink-2')}>기준</b><Dot show={!!rule} />{rule}</span> : null;
}
