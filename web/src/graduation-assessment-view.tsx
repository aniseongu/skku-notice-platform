// 공지 상세의 "졸업요건 확인". 학과 졸업 인턴십과 학교 신3품 인턴십을 따로 보여 주고, 공고만으로 알 수 없는 것은 "수행 뒤 확인"으로 둔다.
import { STATUS_TEXT, reasonOf, type GraduationAssessment, type Track, type VisibleTracks } from './graduation-assessment';

export interface GraduationModel {
  tracks: VisibleTracks;
  assessment: GraduationAssessment | null;
  busy: boolean;
  error: string;
  request: () => void;
  hasKey: boolean;
}

const AI_NOTE = {
  no_key: '공고에 적힌 내용만 봤어요. 설정에서 Gemini 키를 넣으면 담당 업무까지 확인해요',
  unavailable: 'Gemini가 잠시 응답하지 않아 공고 내용만 봤어요. 다시 확인하면 이어서 봐요',
  limit: '오늘 Gemini 한도를 다 써서 공고 내용만 봤어요. 내일 다시 확인해 주세요',
} as const;

/** 이름과 판정은 되면 초록, 안 되면 빨강 글자로, 이유는 일반 글자로 한 줄 적는다. 색만으로 구분하지 않도록 판정도 글로 쓴다. */
const TONE: Record<string, string> = { LIKELY: 'text-accent', CONDITIONAL: 'text-accent', NOT_ELIGIBLE: 'text-danger' };
function Result({ name, track }: { name: string; track: Track }) {
  return <div className="mb-[12px]" data-status={track.status}>
    <p className={`m-0 text-[15px] leading-[22px] font-bold ${TONE[track.status] ?? 'text-ink-2'}`}>{name} · {STATUS_TEXT[track.status]}</p>
    <p className="m-0 mt-[2px] text-[14px] leading-[21px] text-ink">{reasonOf(track)}</p>
  </div>;
}
const LINK = 'p-0 py-[6px] border-0 bg-transparent font-[inherit] text-[13px] leading-[18px] text-ink-2 underline underline-offset-[3px] cursor-pointer disabled:text-ink-3 disabled:cursor-default';

export function GraduationSection({ model }: { title: string; model: GraduationModel }) {
  const { assessment, busy, error } = model;
  const pending = assessment?.state === 'pending';
  const ready = assessment?.state === 'ready' ? assessment : null;
  return <section className="detail-section grad" aria-labelledby="sec-grad">
    <h3 id="sec-grad">졸업요건 확인</h3>
    {!assessment ? <>
      <p className="detail-note first">아직 채우지 못한 졸업요건에 이 공고가 맞는지 살펴봐요. 최종 인정은 학과와 학교가 해요</p>
      {!model.hasKey ? <p className="detail-note">Gemini 키가 없으면 공고에 적힌 내용만 봐서 확인 필요가 많아요</p> : null}
      <button type="button" className="solid-button" disabled={busy} onClick={model.request}>{busy ? '요청하고 있어요' : '졸업요건 확인하기'}</button>
    </> : null}
    {pending ? <p className="detail-note first" role="status">확인하고 있어요. 최대 10분 걸리고, 이 화면을 닫아도 돼요</p> : null}
    {ready ? <>
      {model.tracks.dept && ready.department ? <Result name="학과 졸업 인턴십" track={ready.department} /> : null}
      {model.tracks.p3 && ready.university3p ? <Result name="신3품 인턴십" track={ready.university3p} /> : null}
      {ready.aiStatus && ready.aiStatus !== 'used' ? <p className="m-0 text-[13px] leading-[20px] text-ink-3" role="status">{AI_NOTE[ready.aiStatus]}{' '}
        <button type="button" className={LINK} disabled={busy} onClick={model.request}>{busy ? '요청하고 있어요' : '다시 확인하기'}</button></p> : null}
    </> : null}
    {error ? <p className="field-note error" role="alert">{error}</p> : null}
  </section>;
}
