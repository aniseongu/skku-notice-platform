import { useEffect, useId, useRef, useState } from 'react';
import { BADGE, COLLAPSE_HEAD, DETAIL_SECTION, GHOST_BUTTON, NOTE_TEXT, OPTION_CHIP, SECTION_TITLE, SETTINGS_INPUT, SOLID_BUTTON, TEXT_BUTTON } from './cls';
import { MoreMenu } from './more-menu';
import { BODY_MAX, formatAverage, validateExperience, validateQuestionBody, type Experience, type ExperienceInput, type Experiences, type Question, type Stars } from './questions';

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
  editQuestion: (postId: string, body: string) => Promise<boolean>;
  editReview: (postId: string, input: ExperienceInput) => Promise<boolean>;
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

function Chevron({ open }: { open: boolean }) {
  return <svg className={`size-[16px] flex-none fill-none stroke-current [stroke-width:2] [stroke-linecap:round] [stroke-linejoin:round] ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>;
}

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

function ReviewForm({ model, onDone, post }: { model: QuestionsModel; onDone: () => void; post?: Experience }) {
  const saved = useRef(post ? { satisfaction: post.satisfaction, learning: post.learning, difficulty: post.difficulty, participated: post.participated, body: post.body ?? '' } : model.draft.get()).current;
  const [satisfaction, setSatisfaction] = useState<Stars | null>(saved?.satisfaction ?? null);
  const [learning, setLearning] = useState<Stars | null>(saved?.learning ?? null);
  const [difficulty, setDifficulty] = useState<Stars | null>(saved?.difficulty ?? null);
  const [participated, setParticipated] = useState(saved?.participated ?? false);
  const [body, setBody] = useState(saved?.body ?? '');
  const [more, setMore] = useState(!!(saved && (saved.learning || saved.difficulty || saved.body || saved.participated)));
  const moreId = useId();
  const current: ReviewDraft = { satisfaction, learning, difficulty, participated, body };
  useEffect(() => {
    if (post) return;
    const empty = !satisfaction && !learning && !difficulty && !participated && !body.trim();
    model.draft.set(empty ? null : current);
  }, [satisfaction, learning, difficulty, participated, body]);  // eslint-disable-line react-hooks/exhaustive-deps
  const input: ExperienceInput | null = satisfaction ? { satisfaction, ...(learning ? { learning } : {}), ...(difficulty ? { difficulty } : {}), body, participated } : null;
  const problem = input ? validateExperience(input) : null;
  const submit = () => { if (!model.busy && input && !problem) void (post ? model.editReview(post.id, input) : model.review(input)).then((ok) => { if (ok) { if (!post) model.draft.set(null); onDone(); } }); };
  return <form className="grid gap-[10px] rounded-md border border-line bg-surface p-[12px]" data-qe-editing={post ? '' : undefined} aria-label={post ? '후기 수정' : '후기 남기기'} onSubmit={(event) => { event.preventDefault(); submit(); }}>
    <fieldset className="contents" disabled={!!post && model.busy}>
      {post ? <p className="m-0 text-[14px] font-semibold text-ink">후기 수정</p> : null}
      <StarPicker id="qe-sat" label="업무 만족" value={satisfaction} onChange={setSatisfaction} />
      <button type="button" className={`${TEXT_BUTTON} flex w-full items-center justify-between text-left`} aria-expanded={more} aria-controls={moreId} onClick={() => setMore(!more)}>
        더 남기기 (선택)<Chevron open={more} />
      </button>
      <div id={moreId} hidden={!more} className={more ? 'grid gap-[10px]' : undefined}>
        <StarPicker id="qe-learn" label="배운 정도" value={learning} onChange={setLearning} optional />
        <StarPicker id="qe-diff" label="전형 난이도" value={difficulty} onChange={setDifficulty} optional />
        <label className="grid gap-[4px] text-[13px] font-medium text-ink-2">한마디
          <textarea className={AREA} maxLength={BODY_MAX} value={body} placeholder="분위기나 하는 일, 준비할 점을 편하게 적어 주세요" onChange={(event) => setBody(event.target.value)} /></label>
        <label className="flex min-h-[44px] items-center gap-[10px] text-[14px] text-ink"><input type="checkbox" className="size-[18px] accent-[var(--accent)]" checked={participated} onChange={(event) => setParticipated(event.target.checked)} />이 활동에 직접 참여했어요</label>
      </div>
      {problem ? <p className="m-0 text-[13px] text-danger" role="status">{problem}</p> : null}
      <div className="flex gap-[6px]"><button type="submit" className={SOLID_BUTTON} disabled={model.busy || !input || !!problem}>{post ? '수정 완료' : '후기 남기기'}</button>
        <button type="button" className={GHOST_BUTTON} onClick={onDone}>{post ? '취소' : '닫기'}</button></div>
    </fieldset>
    <p className={NOTE_TEXT}>{post ? '이름은 보이지 않아요. 별점만 남겨도 괜찮아요' : '이름은 보이지 않아요. 별점만 남겨도 괜찮아요. 쓰던 글은 이 기기에 저장돼요'}</p>
  </form>;
}

function QuestionForm({ model, parentId, onDone, label, post }: { model: QuestionsModel; parentId?: string; onDone: () => void; label: string; post?: Question }) {
  const [body, setBody] = useState(post?.body ?? '');
  const problem = body ? validateQuestionBody(body) : null;
  const ok = !!body.trim() && !validateQuestionBody(body);
  return <form className="grid gap-[8px]" data-qe-editing={post ? '' : undefined} aria-label={label} onSubmit={(event) => { event.preventDefault(); if (!model.busy && ok) void (post ? model.editQuestion(post.id, body) : model.ask(body, parentId)).then((done) => { if (done) onDone(); }); }}>
    <fieldset className="contents" disabled={!!post && model.busy}>
      {post ? <p className="m-0 text-[14px] font-semibold text-ink">{label}</p> : null}
      <textarea autoFocus className={AREA} aria-label={label} maxLength={BODY_MAX} value={body} placeholder={parentId ? '아는 만큼 답해 주세요' : '궁금한 점을 적어 주세요'} onChange={(event) => setBody(event.target.value)} />
      {problem ? <p className="m-0 text-[13px] text-danger" role="status">{problem}</p> : null}
      {post ? null : <p className={NOTE_TEXT}>이름은 보이지 않아요. 학교의 공식 답변은 아니에요</p>}
      <div className="flex gap-[6px]"><button type="submit" className={post ? SOLID_BUTTON : GHOST_BUTTON} disabled={model.busy || !ok}>{post ? '수정 완료' : parentId ? '답 남기기' : '질문하기'}</button>
        <button type="button" className={GHOST_BUTTON} onClick={onDone}>{post ? '취소' : '닫기'}</button></div>
    </fieldset>
  </form>;
}

function Actions({ model, mine, postId, noun, onEdit, hidden = false }: { model: QuestionsModel; mine: boolean; postId: string; noun: '후기' | '질문' | '답'; onEdit?: () => void; hidden?: boolean }) {
  const target = noun === '후기' ? '후기를' : `${noun}을`;
  const actions = mine ? [
    ...(!hidden && onEdit ? [{ label: '수정하기', run: onEdit }] : []),
    { label: '지우기', confirm: { question: `이 ${target} 지울까요?`, label: '지우기' }, run: () => model.remove(postId) },
  ] : [
    { label: '신고하기', confirm: { question: `이 ${target} 신고할까요?`, label: '신고하기' }, run: () => model.report(postId) },
    { label: '차단하기', confirm: { question: '이 작성자를 차단할까요?', label: '차단하기' }, run: () => model.block(postId) },
  ];
  return <MoreMenu className="-my-[8px] -mr-[8px] self-start" actions={actions} busy={model.busy} />;
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
  const [editing, setEditing] = useState(false);
  if (editing) return <li><ReviewForm model={model} post={post} onDone={() => setEditing(false)} /></li>;
  return <li className={CARD}>
    <div className="flex min-h-[28px] items-center justify-between gap-[6px]">
      <div className="flex min-w-0 flex-wrap items-center gap-[6px] text-[13px] text-ink-2">
        <span className="text-[15px] font-semibold tabular-nums text-ink"><span aria-hidden="true">★ </span>{post.satisfaction}</span><span className="mr-[2px]">업무 만족</span>
        {post.learning ? <span className={BADGE}>배운 정도 {post.learning}</span> : null}
        {post.difficulty ? <span className={BADGE}>전형 난이도 {post.difficulty}</span> : null}
        {post.mine ? <span className={BADGE}>내 후기</span> : null}
      </div>
      <Actions model={model} mine={post.mine} postId={post.id} noun="후기" hidden={post.hidden} onEdit={() => setEditing(true)} />
    </div>
    {post.participated ? <p className={NOTE_TEXT}>직접 참여했다고 했어요</p> : null}
    {post.body ? <ReviewBody text={post.body} /> : null}
    {post.hidden ? <p className={NOTE_TEXT} role="status">신고가 쌓여 다른 사람에게는 보이지 않아요</p> : null}
  </li>;
}

function Reply({ model, reply }: { model: QuestionsModel; reply: Question }) {
  const [editing, setEditing] = useState(false);
  return <li className="grid gap-[4px] rounded-sm bg-sunken px-[12px] py-[8px]">
    <div className="flex min-h-[28px] items-center gap-[6px]"><span className="text-[13px] font-semibold text-ink">익명 {reply.anonNo}</span>{reply.mine ? <span className={BADGE}>내 글</span> : null}
      <Actions model={model} mine={reply.mine} postId={reply.id} noun="답" hidden={reply.hidden} onEdit={() => setEditing(true)} /></div>
    {editing ? <QuestionForm model={model} post={reply} label="답 수정" onDone={() => setEditing(false)} /> : <p className="m-0 text-[14px] leading-[21px] text-ink whitespace-pre-wrap [overflow-wrap:anywhere]">{reply.body}</p>}
  </li>;
}

function Replies({ model, replies }: { model: QuestionsModel; replies: Question[] }) {
  return <ul className="m-0 grid list-none gap-[6px] p-0" aria-label="답변">{replies.map((reply) => <Reply key={reply.id} model={model} reply={reply} />)}</ul>;
}

function QuestionItem({ model, question, replies, canReply }: { model: QuestionsModel; question: Question; replies: Question[]; canReply: boolean }) {
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  return <li className={CARD}>
    <div className="flex min-h-[28px] items-center gap-[6px]"><span className="text-[14px] font-semibold text-ink">익명 {question.anonNo}</span>{question.mine ? <span className={BADGE}>내 글</span> : null}
      <Actions model={model} mine={question.mine} postId={question.id} noun="질문" hidden={question.hidden} onEdit={replying || editing ? undefined : () => setEditing(true)} /></div>
    {editing ? <QuestionForm model={model} post={question} label="질문 수정" onDone={() => setEditing(false)} /> : <p className="m-0 text-[14px] leading-[21px] text-ink whitespace-pre-wrap [overflow-wrap:anywhere]">{question.body}</p>}
    {question.hidden ? <p className={NOTE_TEXT} role="status">신고가 쌓여 다른 사람에게는 보이지 않아요</p> : null}
    {replies.length ? <Replies model={model} replies={replies} /> : null}
    {replying ? <QuestionForm model={model} parentId={question.id} label="답 남기기" onDone={() => setReplying(false)} />
      : canReply && !editing ? <div className="-ml-[8px]"><button type="button" className={TEXT_BUTTON} onClick={() => setReplying(true)}>답하기</button></div> : null}
  </li>;
}

/** 공고 상세 맨 아래(첨부 위)의 "질문·후기" 구역. 접어 두고 개수만 보인다. 내 글이 있으면 처음부터 펼친다. */
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
  const { experiences } = model;
  const summary = model.status === 'loading' ? '불러오는 중' : model.status === 'failed' ? '불러오지 못했어요' :
    [experiences.count ? `후기 ${experiences.count}` : '', top.length ? `질문 ${top.length}` : ''].filter(Boolean).join(' · ');
  return <section className={`${DETAIL_SECTION} qe [&:has([data-qe-editing])_.qe-create]:hidden`} aria-labelledby="sec-qe">
    <h3 id="sec-qe" className={`${SECTION_TITLE} !mb-0`}>
      <button type="button" className={COLLAPSE_HEAD} aria-expanded={open} aria-controls="qe-body" onClick={() => setOpen(!open)}>
        <span>질문·후기</span><span className="flex items-center gap-[8px] font-medium">{open ? null : summary}
          <Chevron open={open} /></span></button></h3>
    {/* 접어도 마운트를 유지해 수정 중인 입력이 사라지지 않게 한다. */}
    <div id="qe-body" hidden={!open} className={`mt-[6px] gap-[12px] ${open ? 'grid' : 'hidden'}`}>
      {model.status === 'loading' ? <p className={NOTE_TEXT} role="status">불러오고 있어요</p> : null}
      {model.status === 'failed' ? <><p className={NOTE_TEXT} role="status">질문과 후기를 불러오지 못했어요</p><div><button type="button" className={GHOST_BUTTON} onClick={model.load}>다시 불러오기</button></div></> : null}
      {model.status === 'ready' ? <>
        {!hasContent && !reviewing && !asking ? <div className="grid gap-[8px]"><p className="m-0 text-[14px] leading-[21px] text-ink-2">아직 글이 없어요</p>
          <div className="flex flex-wrap gap-[6px]"><button type="button" className={`qe-create ${GHOST_BUTTON}`} onClick={() => setAsking(true)}>질문하기</button>
            <button type="button" className={`qe-create ${GHOST_BUTTON}`} onClick={() => setReviewing(true)}>후기 남기기</button></div></div> : null}

        {experiences.count || experiences.posts.length || reviewing ? <div className="grid gap-[8px]">
          <h4 className={SUBTITLE}>후기</h4>
          {experiences.count ? <RatingSummaryView experiences={experiences} /> : null}
          {experiences.posts.length ? <ul className="m-0 grid list-none gap-[8px] p-0">{experiences.posts.map((post) => <ReviewCard key={post.id} model={model} post={post} />)}</ul> : null}
          {reviewing && !reviewed ? <ReviewForm model={model} onDone={() => setReviewing(false)} />
            : !reviewed ? <div><button type="button" className={`qe-create ${GHOST_BUTTON}`} onClick={() => setReviewing(true)}>후기 남기기</button></div> : null}
        </div> : null}

        {hasContent || asking ? <div className="grid gap-[8px]">
          <h4 className={SUBTITLE}>질문</h4>
          {top.length ? <ul className="m-0 grid list-none gap-[8px] p-0">{top.map((q) => <QuestionItem key={q.id} model={model} question={q} replies={repliesOf(q.id)} canReply={!q.hidden} />)}</ul> : null}
          {detached.length ? <div className="grid gap-[6px]">
            <p className={NOTE_TEXT}>원래 질문을 볼 수 없어요</p>
            <Replies model={model} replies={detached} />
          </div> : null}
          {asking ? <QuestionForm model={model} label="질문하기" onDone={() => setAsking(false)} />
            : <div><button type="button" className={`qe-create ${GHOST_BUTTON}`} onClick={() => setAsking(true)}>질문하기</button></div>}
        </div> : null}
        {hasContent && !experiences.count && !experiences.posts.length && !reviewing ? <div><button type="button" className={`qe-create ${GHOST_BUTTON}`} onClick={() => setReviewing(true)}>후기 남기기</button></div> : null}
        {hasContent ? <p className={NOTE_TEXT}>학교의 공식 답변은 아니에요</p> : null}
      </> : null}
    </div>
  </section>;
}
