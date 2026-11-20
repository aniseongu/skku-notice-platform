import { useEffect, useRef, useState } from 'react';
import { BADGE, COLLAPSE_HEAD, DETAIL_SECTION, GHOST_BUTTON, NOTE_TEXT, OPTION_CHIP, SECTION_TITLE, SETTINGS_INPUT, SOLID_BUTTON, TEXT_BUTTON } from './cls';
import { BODY_MAX, formatAverage, validateExperience, validateQuestionBody, type Experience, type ExperienceInput, type Experiences, type Question, type Stars } from './questions';
import { Confirm } from './team-section';

export interface ReviewDraft { satisfaction: Stars | null; learning: Stars | null; difficulty: Stars | null; participated: boolean; body: string }

export interface QuestionsModel {
  key: string;
  status: 'loading' | 'ready' | 'failed';
  questions: Question[];
  experiences: Experiences;
  busy: boolean;
  load: () => void;
  ask: (body: string, parentId?: string) => Promise<boolean>;
  review: (input: ExperienceInput) => Promise<boolean>;
  remove: (postId: string) => Promise<boolean>;
  report: (postId: string) => Promise<boolean>;
  block: (postId: string) => Promise<boolean>;
  /** 쓰던 후기를 이 기기에 계정·공고별로 보관한다. */
  draft: { get: () => ReviewDraft | null; set: (value: ReviewDraft | null) => void };
}

const CARD = 'qe-post grid gap-[8px] rounded-md border border-line bg-surface p-[12px]';
/** 이 글자 수나 줄 수를 넘으면 본문을 4줄로 줄이고 "더 보기"를 보인다. */
const CLAMP_CHARS = 120;
const CLAMP_LINES = 4;
const AREA = `${SETTINGS_INPUT} min-h-[88px] w-full resize-y leading-[22px]`;
const SUBTITLE = 'm-0 text-[14px] leading-[21px] font-bold text-ink';
const STAR_VALUES: readonly Stars[] = [1, 2, 3, 4, 5];

function RatingSummaryView({ experiences }: { experiences: Experiences }) {
  const { satisfaction, learning, difficulty } = experiences;
  const parts = [
    learning.count > 0 ? `배운 정도 ${formatAverage(learning.average)}(${learning.count}명)` : '',
    difficulty.count > 0 ? `전형 난이도 ${formatAverage(difficulty.average)}(${difficulty.count}명)` : '',
  ].filter(Boolean);
  if (!satisfaction.count) return null;
  return <div className="grid gap-[2px]">
    <p className="m-0 flex items-baseline gap-[8px] text-[15px] leading-[28px] text-ink-2">
      <span className="text-[22px] leading-[28px] font-bold tabular-nums text-ink"><span aria-hidden="true">★ </span>{formatAverage(satisfaction.average)}</span>
      <span>업무 만족 · 후기 {experiences.count}개</span></p>
    {parts.length ? <p className={`m-0 text-[12px] leading-[18px] tabular-nums text-ink-2`}>{parts.join(' · ')}</p> : null}
  </div>;
}

function StarPicker({ id, label, value, onChange, optional }: { id: string; label: string; value: Stars | null; onChange: (v: Stars | null) => void; optional?: boolean }) {
  return <div className="grid gap-[4px]"><span className="flex items-center gap-[6px] text-[13px] font-medium text-ink-2"><span id={id}>{label}</span>{optional ? null : <span className={BADGE}>필수</span>}</span>
    <div role="radiogroup" aria-labelledby={id} className="grid grid-cols-5 gap-[6px]">
      {STAR_VALUES.map((n) => <button type="button" role="radio" key={n} className={OPTION_CHIP} aria-checked={value === n} aria-label={`${label} ${n}점`}
        onClick={() => onChange(optional && value === n ? null : n)}><span aria-hidden="true">★</span><span className="tabular-nums">{n}</span></button>)}</div></div>;
}

function ReviewForm({ model, onDone }: { model: QuestionsModel; onDone: () => void }) {
  const saved = useRef(model.draft.get()).current;
  const [satisfaction, setSatisfaction] = useState<Stars | null>(saved?.satisfaction ?? null);
  const [learning, setLearning] = useState<Stars | null>(saved?.learning ?? null);
  const [difficulty, setDifficulty] = useState<Stars | null>(saved?.difficulty ?? null);
  const [participated, setParticipated] = useState(saved?.participated ?? false);
  const [body, setBody] = useState(saved?.body ?? '');
  const [more, setMore] = useState(!!(saved && (saved.learning || saved.difficulty || saved.body || saved.participated)));
  const current: ReviewDraft = { satisfaction, learning, difficulty, participated, body };
  useEffect(() => {
    const empty = !satisfaction && !learning && !difficulty && !participated && !body.trim();
    model.draft.set(empty ? null : current);
  }, [satisfaction, learning, difficulty, participated, body]);  // eslint-disable-line react-hooks/exhaustive-deps
  const input: ExperienceInput | null = satisfaction ? { satisfaction, ...(learning ? { learning } : {}), ...(difficulty ? { difficulty } : {}), body, participated } : null;
  const problem = input ? validateExperience(input) : null;
  const submit = () => { if (input && !problem) void model.review(input).then((ok) => { if (ok) { model.draft.set(null); onDone(); } }); };
  return <form className="grid gap-[10px] rounded-md border border-line bg-surface p-[12px]" aria-label="후기 남기기" onSubmit={(event) => { event.preventDefault(); submit(); }}>
    <StarPicker id="qe-sat" label="업무 만족" value={satisfaction} onChange={setSatisfaction} />
    {more ? <div className="grid gap-[10px]">
      <p className="m-0 flex items-center gap-[6px] text-[13px] font-semibold text-ink-2">더 남기기<span className={BADGE}>선택</span></p>
      <StarPicker id="qe-learn" label="배운 정도" value={learning} onChange={setLearning} optional />
      <StarPicker id="qe-diff" label="전형 난이도" value={difficulty} onChange={setDifficulty} optional />
      <label className="grid gap-[4px] text-[13px] font-medium text-ink-2">한마디
        <textarea className={AREA} maxLength={BODY_MAX} value={body} placeholder="분위기나 하는 일, 준비할 점을 편하게 적어 주세요" onChange={(event) => setBody(event.target.value)} /></label>
      <label className="flex min-h-[44px] items-center gap-[10px] text-[14px] text-ink"><input type="checkbox" className="size-[18px] accent-[var(--accent)]" checked={participated} onChange={(event) => setParticipated(event.target.checked)} />이 활동에 직접 참여했어요</label>
    </div> : <div className="-ml-[8px]"><button type="button" className={TEXT_BUTTON} aria-expanded={false} onClick={() => setMore(true)}>더 남기기 (선택)</button></div>}
    <p className={NOTE_TEXT}>이름은 보이지 않아요. 별점만 남겨도 괜찮아요. 쓰던 글은 이 기기에 저장돼요</p>
    {problem ? <p className="m-0 text-[13px] text-danger" role="status">{problem}</p> : null}
    <div className="flex gap-[6px]"><button type="submit" className={SOLID_BUTTON} disabled={model.busy || !input || !!problem}>후기 남기기</button>
      <button type="button" className={GHOST_BUTTON} onClick={onDone}>닫기</button></div>
  </form>;
}

function QuestionForm({ model, parentId, onDone, label }: { model: QuestionsModel; parentId?: string; onDone: () => void; label: string }) {
  const [body, setBody] = useState('');
  const problem = body ? validateQuestionBody(body) : null;
  const ok = !!body.trim() && !validateQuestionBody(body);
  return <form className="grid gap-[8px]" aria-label={label} onSubmit={(event) => { event.preventDefault(); if (ok) void model.ask(body, parentId).then((done) => { if (done) onDone(); }); }}>
    <textarea autoFocus className={AREA} aria-label={label} maxLength={BODY_MAX} value={body} placeholder={parentId ? '아는 만큼 답해 주세요' : '궁금한 점을 적어 주세요'} onChange={(event) => setBody(event.target.value)} />
    {problem ? <p className="m-0 text-[13px] text-danger" role="status">{problem}</p> : null}
    <div className="flex gap-[6px]"><button type="submit" className={GHOST_BUTTON} disabled={model.busy || !ok}>{parentId ? '답 남기기' : '질문하기'}</button>
      <button type="button" className={GHOST_BUTTON} onClick={onDone}>닫기</button></div>
  </form>;
}

function Actions({ model, mine, postId, noun }: { model: QuestionsModel; mine: boolean; postId: string; noun: string }) {
  const [more, setMore] = useState(false);
  if (mine) return <div className="-ml-[8px]"><Confirm label="삭제" question={`이 ${noun}을 지울까요?`} disabled={model.busy} onConfirm={() => { void model.remove(postId); }} /></div>;
  return <div className="-ml-[8px]">{more ? <span className="inline-flex flex-wrap items-center">
    <Confirm label="신고" question={`이 ${noun}을 신고할까요?`} disabled={model.busy} onConfirm={() => { void model.report(postId); }} />
    <Confirm label="작성자 차단" question="이 작성자를 차단할까요?" disabled={model.busy} onConfirm={() => { void model.block(postId); }} />
    <button type="button" className={TEXT_BUTTON} onClick={() => setMore(false)}>닫기</button></span>
    : <button type="button" className={TEXT_BUTTON} aria-expanded={false} onClick={() => setMore(true)}>신고·차단</button>}</div>;
}

function ReviewBody({ text }: { text: string }) {
  const long = text.length > CLAMP_CHARS || text.split('\n').length > CLAMP_LINES;
  const [expanded, setExpanded] = useState(false);
  return <div className="grid gap-[2px]">
    <p className={`m-0 text-[14px] leading-[21px] text-ink whitespace-pre-wrap [overflow-wrap:anywhere] ${long && !expanded ? 'line-clamp-4' : ''}`}>{text}</p>
    {long ? <div className="-ml-[8px]"><button type="button" className={TEXT_BUTTON} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '접기' : '더 보기'}</button></div> : null}
  </div>;
}

function ReviewCard({ model, post }: { model: QuestionsModel; post: Experience }) {
  return <li className={CARD}>
    <div className="flex flex-wrap items-center gap-[6px] text-[13px] text-ink-2">
      <span className="text-[15px] font-semibold tabular-nums text-ink"><span aria-hidden="true">★ </span>{post.satisfaction}</span><span className="mr-[2px]">업무 만족</span>
      {post.learning ? <span className={BADGE}>배운 정도 {post.learning}</span> : null}
      {post.difficulty ? <span className={BADGE}>전형 난이도 {post.difficulty}</span> : null}
      {post.mine ? <span className={BADGE}>내 후기</span> : null}
    </div>
    {post.participated ? <p className={NOTE_TEXT}>직접 참여했다고 했어요</p> : null}
    {post.body ? <ReviewBody text={post.body} /> : null}
    {post.hidden ? <p className={NOTE_TEXT} role="status">신고가 쌓여 다른 사람에게는 보이지 않아요</p> : null}
    <Actions model={model} mine={post.mine} postId={post.id} noun="후기" />
  </li>;
}

function Replies({ model, replies }: { model: QuestionsModel; replies: Question[] }) {
  return <ul className="m-0 grid list-none gap-[6px] p-0" aria-label="답변">{replies.map((reply) => <li key={reply.id} className="grid gap-[4px] rounded-sm bg-sunken px-[12px] py-[8px]">
    <div className="flex items-center gap-[6px]"><span className="text-[13px] font-semibold text-ink">익명 {reply.anonNo}</span>{reply.mine ? <span className={BADGE}>내 글</span> : null}</div>
    <p className="m-0 text-[14px] leading-[21px] text-ink whitespace-pre-wrap [overflow-wrap:anywhere]">{reply.body}</p>
    <div className="-ml-[8px]"><Actions model={model} mine={reply.mine} postId={reply.id} noun="답" /></div>
  </li>)}</ul>;
}

function QuestionItem({ model, question, replies, canReply }: { model: QuestionsModel; question: Question; replies: Question[]; canReply: boolean }) {
  const [replying, setReplying] = useState(false);
  return <li className={CARD}>
    <div className="flex items-center gap-[6px]"><span className="text-[14px] font-semibold text-ink">익명 {question.anonNo}</span>{question.mine ? <span className={BADGE}>내 글</span> : null}</div>
    <p className="m-0 text-[14px] leading-[21px] text-ink whitespace-pre-wrap [overflow-wrap:anywhere]">{question.body}</p>
    {question.hidden ? <p className={NOTE_TEXT} role="status">신고가 쌓여 다른 사람에게는 보이지 않아요</p> : null}
    {replies.length ? <Replies model={model} replies={replies} /> : null}
    {replying ? <QuestionForm model={model} parentId={question.id} label="답 남기기" onDone={() => setReplying(false)} />
      : <div className="flex flex-wrap items-center gap-[12px]">
        {canReply ? <div className="-ml-[8px]"><button type="button" className={TEXT_BUTTON} onClick={() => setReplying(true)}>답하기</button></div> : null}
        <Actions model={model} mine={question.mine} postId={question.id} noun="질문" /></div>}
  </li>;
}

/** 공고 상세 맨 아래(첨부 위)의 "질문·경험" 구역. 접어 두고 개수만 보인다. 내 글이 있으면 처음부터 펼친다. */
export function QuestionsSection({ model }: { model: QuestionsModel }) {
  const [open, setOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [asking, setAsking] = useState(false);
  const autoOpened = useRef(false);
  useEffect(() => { model.load(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!autoOpened.current && model.status === 'ready') { autoOpened.current = true; if (model.questions.some((q) => q.mine) || model.experiences.posts.some((p) => p.mine)) setOpen(true); }
  }, [model.status, model.questions, model.experiences]);
  const top = model.questions.filter((q) => !q.parentId && !q.detached);
  const detached = model.questions.filter((q) => q.detached);
  const repliesOf = (id: string) => model.questions.filter((q) => q.parentId === id && !q.detached);
  const total = top.length + model.experiences.count;
  const hasContent = total > 0 || detached.length > 0;
  const reviewed = model.experiences.posts.some((p) => p.mine);
  useEffect(() => { if (reviewed) setReviewing(false); }, [reviewed]);
  const summary = model.status === 'loading' ? '불러오는 중' : model.status === 'failed' ? '불러오지 못했어요' : total ? `${total}` : detached.length ? `답변 ${detached.length}개` : '아직 글이 없어요';
  const { experiences } = model;
  return <section className={`${DETAIL_SECTION} qe`} aria-labelledby="sec-qe">
    <h3 id="sec-qe" className={`${SECTION_TITLE} !mb-0`}>
      <button type="button" className={COLLAPSE_HEAD} aria-expanded={open} aria-controls="qe-body" onClick={() => setOpen(!open)}>
        <span>질문·경험</span><span className="flex items-center gap-[8px] font-medium">{summary}
          <svg className={`size-[16px] flex-none fill-none stroke-current [stroke-width:2] [stroke-linecap:round] [stroke-linejoin:round] ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></span></button></h3>
    {open ? <div id="qe-body" className="mt-[6px] grid gap-[12px]">
      {model.status === 'loading' ? <p className={NOTE_TEXT} role="status">불러오고 있어요</p> : null}
      {model.status === 'failed' ? <><p className={NOTE_TEXT} role="status">질문과 후기를 불러오지 못했어요</p><div><button type="button" className={GHOST_BUTTON} onClick={model.load}>다시 불러오기</button></div></> : null}
      {model.status === 'ready' ? <>
        {!hasContent && !reviewing && !asking ? <div className="grid gap-[8px]"><p className="m-0 text-[14px] leading-[21px] text-ink-2">아직 남은 글이 없어요. 먼저 궁금한 점을 묻거나 경험을 남겨 봐요</p>
          <div className="flex flex-wrap gap-[6px]"><button type="button" className={SOLID_BUTTON} onClick={() => setReviewing(true)}>후기 남기기</button>
            <button type="button" className={GHOST_BUTTON} onClick={() => setAsking(true)}>질문하기</button></div></div> : null}

        {experiences.count || experiences.posts.length || reviewing ? <div className="grid gap-[8px]">
          <h4 className={SUBTITLE}>후기</h4>
          {experiences.count ? <RatingSummaryView experiences={experiences} /> : null}
          {experiences.posts.length ? <ul className="m-0 grid list-none gap-[8px] p-0">{experiences.posts.map((post) => <ReviewCard key={post.id} model={model} post={post} />)}</ul> : null}
          {reviewing && !reviewed ? <ReviewForm model={model} onDone={() => setReviewing(false)} />
            : !reviewed ? <div><button type="button" className={GHOST_BUTTON} onClick={() => setReviewing(true)}>후기 남기기</button></div> : null}
        </div> : null}

        {hasContent || asking ? <div className="grid gap-[8px]">
          <h4 className={SUBTITLE}>질문</h4>
          {top.length ? <ul className="m-0 grid list-none gap-[8px] p-0">{top.map((q) => <QuestionItem key={q.id} model={model} question={q} replies={repliesOf(q.id)} canReply={!q.hidden} />)}</ul> : null}
          {detached.length ? <div className="grid gap-[6px]">
            <p className={NOTE_TEXT}>원래 질문을 볼 수 없어요</p>
            <Replies model={model} replies={detached} />
          </div> : null}
          {asking ? <QuestionForm model={model} label="질문하기" onDone={() => setAsking(false)} />
            : <div><button type="button" className={GHOST_BUTTON} onClick={() => setAsking(true)}>질문하기</button></div>}
        </div> : null}
        {hasContent && !experiences.count && !experiences.posts.length && !reviewing ? <div><button type="button" className={GHOST_BUTTON} onClick={() => setReviewing(true)}>후기 남기기</button></div> : null}
        <p className={NOTE_TEXT}>이름은 보이지 않아요. 학교의 공식 답변은 아니에요</p>
      </> : null}
    </div> : null}
  </section>;
}
