// 공지 상세의 "졸업요건 확인". 서버가 수집할 때 미리 판정해 두고, 이 화면은 결과를 글로만 보여 준다(버튼 없음).
// 이름·판정은 되면 초록, 안 되면 빨강 글자로, 이유는 일반 글자로 한 문장 적는다. 색만으로 구분하지 않도록 판정도 글로 쓴다.
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

const TONE: Record<string, string> = { LIKELY: 'text-accent', CONDITIONAL: 'text-accent', NOT_ELIGIBLE: 'text-danger' };

function Result({ name, track }: { name: string; track: Track }) {
  return <div className="mb-[12px]" data-status={track.status}>
    <p className={`m-0 text-[15px] leading-[22px] font-bold ${TONE[track.status] ?? 'text-ink-2'}`}>{name} · {STATUS_TEXT[track.status]}</p>
    <p className="m-0 mt-[2px] text-[14px] leading-[21px] text-ink">{reasonOf(track)}</p>
  </div>;
}

export function GraduationSection({ model }: { title: string; model: GraduationModel }) {
  const { assessment, error } = model;
  const ready = assessment?.state === 'ready' ? assessment : null;
  return <section className="detail-section grad" aria-labelledby="sec-grad">
    <h3 id="sec-grad">졸업요건 확인</h3>
    {!ready && !error ? <p className="m-0 text-[14px] leading-[21px] text-ink-3" role="status">내 졸업요건에 맞는지 확인하고 있어요</p> : null}
    {ready ? <>
      {model.tracks.p3 && ready.university3p ? <Result name="신3품 인턴십" track={ready.university3p} /> : null}
      {model.tracks.dept && ready.department ? <Result name="학과 졸업 인턴십" track={ready.department} /> : null}
      {ready.aiStatus && ready.aiStatus !== 'used' ? <p className="m-0 text-[13px] leading-[20px] text-ink-3" role="status">{AI_NOTE[ready.aiStatus]}</p> : null}
    </> : null}
    {error ? <p className="field-note error" role="alert">{error}</p> : null}
  </section>;
}
