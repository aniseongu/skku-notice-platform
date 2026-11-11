// 공지 상세의 "졸업요건 확인". 서버가 수집할 때 미리 판정해 두고, 이 화면은 결과를 글로만 보여 준다(버튼 없음).
// 영역 이름, 판정 키워드(되면 초록·안 되면 빨강), 이유가 한 문단에 이어진다. 색만으로 구분하지 않도록 판정도 글로 쓴다.
import { STATUS_TEXT, reasonOf, type GraduationAssessment, type Track, type VisibleTracks } from './graduation-assessment';

export interface GraduationModel {
  tracks: VisibleTracks;
  assessment: GraduationAssessment | null;
  error: string;
}

const AI_NOTE = {
  no_key: 'Gemini 키를 넣으면 담당 업무까지 확인해요',
  unavailable: 'Gemini가 응답하지 않아 공고 내용만 봤어요. 잠시 뒤 다시 확인해요',
  limit: '오늘 Gemini 한도를 다 써서 공고 내용만 봤어요. 내일 다시 확인해요',
} as const;

// 목록의 "해당 / 확인 필요 / 해당 없음"(reason.tsx)과 같은 모양: 되면 강조색 굵게, 확인은 주황 굵게, 안 되면 굵지 않은 옅은 회색(이유도 같이 옅게).
const KEYWORD: Record<string, string> = {
  LIKELY: 'font-semibold text-accent',
  CONDITIONAL: 'font-semibold text-soon',
  NEEDS_REVIEW: 'font-semibold text-soon',
  NOT_ELIGIBLE: 'font-normal text-ink-3',
  NOT_APPLICABLE: 'font-normal text-ink-3',
};
const MUTED = new Set(['NOT_ELIGIBLE', 'NOT_APPLICABLE']);

/** "3품 인턴십 가능" 키워드 바로 옆에 이유가 이어지는 한 문단. */
function Result({ name, track }: { name: string; track: Track }) {
  return <p className={`m-0 mb-[8px] text-[14px] leading-[21px] [word-break:keep-all] ${MUTED.has(track.status) ? 'text-ink-3' : 'text-ink-2'}`} data-status={track.status}>
    <b className={`mr-[6px] ${KEYWORD[track.status] ?? 'font-semibold text-ink-2'}`}>{name} {STATUS_TEXT[track.status]}</b>{reasonOf(track)}
  </p>;
}

export function GraduationSection({ model }: { title: string; model: GraduationModel }) {
  const { assessment, error } = model;
  const ready = assessment?.state === 'ready' ? assessment : null;
  return <section className="detail-section grad" aria-labelledby="sec-grad">
    <h3 id="sec-grad">인턴십 요건 확인</h3>
    {!ready && !error ? <p className="m-0 text-[14px] leading-[21px] text-ink-3" role="status">내 인턴십 요건에 맞는지 확인하고 있어요</p> : null}
    {ready ? <>
      {model.tracks.p3 && ready.university3p ? <Result name="3품 인턴십" track={ready.university3p} /> : null}
      {model.tracks.dept && ready.department ? <Result name="솦 인턴십" track={ready.department} /> : null}
    </> : null}
    {error ? <p className="field-note error" role="alert">{error}</p> : null}
  </section>;
}

/** 안내문은 결과 옆이 아니라 공지 맨 아래에 작고 옅게 둔다(Toss: 읽는 흐름을 끊지 않는 보조 안내). 판정이 나온 뒤에만 보인다. */
export function GraduationNotes({ model }: { model: GraduationModel }) {
  const ready = model.assessment?.state === 'ready' ? model.assessment : null;
  if (!ready) return null;
  return <div className="mt-[20px] text-[12px] leading-[18px] text-ink-3 [word-break:keep-all]">
    <p className="m-0">인턴십 요건은 공고에 적힌 내용만 보고 대략 판단해요. 실제 인정 여부는 학교와 학과에 확인해 주세요</p>
    {ready.aiStatus && ready.aiStatus !== 'used' ? <p className="m-0 mt-[4px]" role="status">{AI_NOTE[ready.aiStatus]}</p> : null}
  </div>;
}
