import { useEffect, useRef, useState } from 'react';
import { BADGE, COLLAPSE_HEAD, DETAIL_SECTION, GHOST_BUTTON, NOTE_TEXT, OPTION_CHIP, SECTION_TITLE, SETTINGS_INPUT, SOLID_BUTTON, TEXT_BUTTON, TEXT_BUTTON_DANGER } from './cls';
import { CAPACITY_CHOICES, DEFAULT_CAPACITY, INTRO_MAX, MESSAGE_MAX, ROLE_MAX, contactHref, validateContact, validateTeamDraft, type TeamApplicant, type TeamDraft, type TeamPost } from './team';

export interface TeamModel {
  status: 'loading' | 'ready' | 'failed';
  posts: TeamPost[];
  busy: boolean;
  /** 공고 마감이 지났으면 새 모집은 못 만든다(신청·승인은 계속). */
  canCreate: boolean;
  load: () => void;
  create: (draft: TeamDraft) => Promise<boolean>;
  apply: (post: TeamPost, message: string) => Promise<boolean>;
  withdraw: (post: TeamPost) => Promise<boolean>;
  setClosed: (post: TeamPost, closed: boolean) => Promise<boolean>;
  remove: (post: TeamPost) => Promise<boolean>;
  applicants: (post: TeamPost) => Promise<TeamApplicant[] | null>;
  /** 연락처를 함께 주면 먼저 저장하고 승인한다. 연락처가 없어 막히면 'contact'를 돌려준다. */
  decide: (post: TeamPost, applicant: TeamApplicant, decision: 'approved' | 'rejected', contact?: string) => Promise<'ok' | 'contact' | 'error'>;
  contact: (post: TeamPost) => Promise<string | null | undefined>;
  report: (post: TeamPost) => Promise<boolean>;
  blockOwner: (post: TeamPost) => Promise<boolean>;
  blockApplicant: (applicant: TeamApplicant) => Promise<boolean>;
}

const CARD = 'team-post grid gap-[8px] rounded-md border border-line bg-surface p-[12px]';
const STATE_LABEL = { open: '모집 중', full: '자리 참', closed: '마감' } as const;

/** 확인 한 단계가 필요한 보조 동작(신고, 차단, 삭제). */
function Confirm({ label, question, danger = true, onConfirm, disabled }: { label: string; question: string; danger?: boolean; onConfirm: () => void; disabled?: boolean }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button type="button" className={TEXT_BUTTON} disabled={disabled} onClick={() => setAsking(true)}>{label}</button>;
  return <span className="inline-flex flex-wrap items-center gap-[2px]" role="group" aria-label={label}>
    <span className="px-[8px] text-[13px] text-ink-2">{question}</span>
    <button type="button" className={danger ? TEXT_BUTTON_DANGER : TEXT_BUTTON} disabled={disabled} onClick={() => { setAsking(false); onConfirm(); }}>{label}</button>
    <button type="button" className={TEXT_BUTTON} onClick={() => setAsking(false)}>취소</button>
  </span>;
}

/** 연락처: http(s) 주소만 링크, 나머지는 글자로만 보인다. */
export function ContactValue({ contact }: { contact: string }) {
  const href = contactHref(contact);
  return href
    ? <a className="contact-link break-all text-accent underline underline-offset-[3px]" href={href} target="_blank" rel="noopener noreferrer nofollow">{contact}</a>
    : <span className="contact-text break-all font-semibold text-ink">{contact}</span>;
}

function ContactReveal({ model, post }: { model: TeamModel; post: TeamPost }) {
  const [value, setValue] = useState<string | null | undefined>(null);
  const [shown, setShown] = useState(false);
  if (shown && value) return <p className="m-0 rounded-sm bg-sunken px-[12px] py-[10px] text-[14px] leading-[21px]" role="status">연락처 <ContactValue contact={value} /></p>;
  return <>
    <button type="button" className={GHOST_BUTTON} disabled={model.busy} onClick={() => { void model.contact(post).then((result) => { setValue(result); setShown(true); }); }}>연락처 보기</button>
    {shown && !value ? <p className={NOTE_TEXT} role="status">연락처를 아직 받지 못했어요. 모집자가 등록하면 보여요</p> : null}
  </>;
}

function ApplicantRow({ model, post, applicant, onChanged }: { model: TeamModel; post: TeamPost; applicant: TeamApplicant; onChanged: () => void }) {
  const [asking, setAsking] = useState(false);
  const [contact, setContact] = useState('');
  const problem = asking && contact ? validateContact(contact) : null;
  const decide = async (decision: 'approved' | 'rejected', withContact?: string) => {
    const result = await model.decide(post, applicant, decision, withContact);
    if (result === 'contact') setAsking(true); else if (result === 'ok') { setAsking(false); onChanged(); }
  };
  const pending = applicant.status === 'pending';
  return <li className="grid gap-[6px] border-t border-line py-[8px] first:border-t-0">
    <div className="flex min-h-[44px] flex-wrap items-center gap-x-[8px] gap-y-[2px]">
      <span className="text-[14px] font-semibold text-ink">익명 {applicant.anonNo}</span>
      {applicant.message ? <span className="min-w-0 flex-1 text-[13px] leading-[19px] text-ink-2 [overflow-wrap:anywhere]">{applicant.message}</span> : <span className="flex-1" />}
      {pending ? <span className="flex gap-[6px]">
        <button type="button" className={`${GHOST_BUTTON} !min-h-[44px] !px-[14px]`} disabled={model.busy} onClick={() => { void decide('approved'); }}>승인</button>
        <button type="button" className={`${GHOST_BUTTON} !min-h-[44px] !px-[14px]`} disabled={model.busy} onClick={() => { void decide('rejected'); }}>거절</button>
      </span> : <span className="text-[13px] font-medium text-ink-2">{applicant.status === 'approved' ? '승인함' : '거절함'}</span>}
    </div>
    {asking ? <form className="grid gap-[6px]" onSubmit={(event) => { event.preventDefault(); if (!validateContact(contact)) void decide('approved', contact); }}>
      <label className={NOTE_TEXT} htmlFor={`contact-${applicant.id}`}>승인한 분께만 보여요. 오픈채팅 링크나 아이디, 이메일을 한 번만 알려 주세요</label>
      <input id={`contact-${applicant.id}`} type="text" autoFocus className={`${SETTINGS_INPUT} w-full`} maxLength={200} value={contact} placeholder="https://open.kakao.com/..." onChange={(event) => setContact(event.target.value)} />
      {problem ? <p className="m-0 text-[13px] text-danger" role="status">{problem}</p> : null}
      <div className="flex gap-[6px]"><button type="submit" className={SOLID_BUTTON} disabled={model.busy || !contact.trim() || !!validateContact(contact)}>저장하고 승인</button>
        <button type="button" className={GHOST_BUTTON} onClick={() => setAsking(false)}>취소</button></div>
    </form> : null}
    <div className="-ml-[8px]"><Confirm label="차단" question="이 신청자를 차단할까요?" disabled={model.busy} onConfirm={() => { void model.blockApplicant(applicant).then((ok) => { if (ok) onChanged(); }); }} /></div>
  </li>;
}

function Applicants({ model, post }: { model: TeamModel; post: TeamPost }) {
  const [items, setItems] = useState<TeamApplicant[] | null | undefined>(undefined);
  const reload = () => { void model.applicants(post).then(setItems); };
  useEffect(reload, [post.id, post.approved]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (items === undefined) return <p className={NOTE_TEXT} role="status">신청자를 불러오고 있어요</p>;
  if (items === null) return <p className={NOTE_TEXT} role="status">신청자를 불러오지 못했어요. 다시 열어 주세요</p>;
  if (!items.length) return <p className={NOTE_TEXT}>아직 신청한 사람이 없어요</p>;
  return <ul className="m-0 list-none p-0" aria-label="신청자">{items.map((item) => <ApplicantRow key={item.id} model={model} post={post} applicant={item} onChanged={reload} />)}</ul>;
}

function PostCard({ model, post }: { model: TeamModel; post: TeamPost }) {
  const [listOpen, setListOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const left = Math.max(post.capacity - post.approved, 0);
  const canApply = !post.mine && post.state === 'open' && (post.myStatus === null || post.myStatus === 'withdrawn');
  const fine = post.state === 'open';
  return <li className={CARD}>
    <div className="flex flex-wrap items-center gap-[8px]">
      <h4 className="m-0 min-w-0 text-[15px] leading-[22px] font-bold text-ink [overflow-wrap:anywhere]">{post.role}</h4>
      <span className={`${BADGE} ${post.state === 'closed' ? '!text-ink-3' : ''}`}>{STATE_LABEL[post.state]}</span>
      {post.mine ? <span className={BADGE}>내 모집</span> : null}
    </div>
    <p className="m-0 text-[14px] leading-[21px] text-ink [overflow-wrap:anywhere]">{post.intro}</p>
    <p className={NOTE_TEXT}>{post.capacity}명 중 {post.approved}명이 모였어요{fine ? ` · ${left}자리 남았어요` : ''}</p>
    {post.hidden ? <p className={NOTE_TEXT} role="status">신고가 쌓여 다른 사람에게는 보이지 않아요</p> : null}

    {canApply ? (noteOpen
      ? <form className="grid gap-[6px]" onSubmit={(event) => { event.preventDefault(); void model.apply(post, note); }}>
        <input type="text" autoFocus className={`${SETTINGS_INPUT} w-full`} aria-label="신청 한 줄" maxLength={MESSAGE_MAX} value={note} placeholder="하고 싶은 말을 한 줄 남겨요 (선택)" onChange={(event) => setNote(event.target.value)} />
        <div className="flex gap-[6px]"><button type="submit" className={SOLID_BUTTON} disabled={model.busy}>신청 보내기</button>
          <button type="button" className={GHOST_BUTTON} onClick={() => setNoteOpen(false)}>취소</button></div>
      </form>
      : <div className="flex flex-wrap items-center gap-[6px]">
        <button type="button" className={SOLID_BUTTON} disabled={model.busy} onClick={() => { void model.apply(post, ''); }}>신청할래요</button>
        <button type="button" className={TEXT_BUTTON} onClick={() => setNoteOpen(true)}>한 줄 남기고 신청</button></div>) : null}

    {!post.mine && post.myStatus === 'pending' ? <div className="flex flex-wrap items-center gap-[6px]">
      <span className="text-[14px] font-semibold text-ink">신청했어요</span><span className={NOTE_TEXT}>승인을 기다려요</span>
      <button type="button" className={TEXT_BUTTON} disabled={model.busy} onClick={() => { void model.withdraw(post); }}>신청 취소</button></div> : null}
    {!post.mine && post.myStatus === 'approved' ? <div className="grid gap-[6px]">
      <span className="text-[14px] font-semibold text-ink">승인됐어요</span><ContactReveal model={model} post={post} />
      <div className="-ml-[8px]"><button type="button" className={TEXT_BUTTON} disabled={model.busy} onClick={() => { void model.withdraw(post); }}>함께하기 취소</button></div></div> : null}
    {!post.mine && post.myStatus === 'rejected' ? <p className={NOTE_TEXT}>이번에는 함께하지 못했어요</p> : null}
    {!post.mine && !canApply && !post.myStatus && post.state !== 'open' ? <p className={NOTE_TEXT}>{post.state === 'full' ? '자리가 모두 찼어요' : '모집이 끝났어요'}</p> : null}

    {post.mine ? <div className="grid gap-[6px]">
      <div className="flex flex-wrap gap-[6px]">
        <button type="button" className={GHOST_BUTTON} aria-expanded={listOpen} onClick={() => setListOpen(!listOpen)}>{listOpen ? '신청자 접기' : '신청자 보기'}</button>
        <button type="button" className={GHOST_BUTTON} disabled={model.busy}
          onClick={() => { void model.setClosed(post, post.state !== 'closed'); }}>{post.state === 'closed' ? '다시 열기' : '모집 마감'}</button>
      </div>
      {listOpen ? <Applicants model={model} post={post} /> : null}
      <div className="-ml-[8px]"><Confirm label="삭제" question="이 모집을 지울까요?" disabled={model.busy} onConfirm={() => { void model.remove(post); }} /></div>
    </div> : <div className="-ml-[8px]">
      {moreOpen ? <span className="inline-flex flex-wrap items-center">
        <Confirm label="신고" question="이 모집을 신고할까요?" disabled={model.busy} onConfirm={() => { void model.report(post); }} />
        <Confirm label="모집자 차단" question="이 모집자를 차단할까요?" disabled={model.busy} onConfirm={() => { void model.blockOwner(post); }} />
        <button type="button" className={TEXT_BUTTON} onClick={() => setMoreOpen(false)}>닫기</button></span>
        : <button type="button" className={TEXT_BUTTON} aria-expanded={false} onClick={() => setMoreOpen(true)}>더 보기</button>}
    </div>}
  </li>;
}

function CreateForm({ model, onDone }: { model: TeamModel; onDone: () => void }) {
  const [role, setRole] = useState('');
  const [capacity, setCapacity] = useState(DEFAULT_CAPACITY);
  const [intro, setIntro] = useState('');
  const draft = { role, capacity, intro };
  const problem = validateTeamDraft(draft);
  return <form className="grid gap-[10px] rounded-md border border-line bg-surface p-[12px]" aria-label="팀원 모집하기"
    onSubmit={(event) => { event.preventDefault(); if (!problem) void model.create(draft).then((ok) => { if (ok) onDone(); }); }}>
    <label className="grid gap-[4px] text-[13px] font-medium text-ink-2">역할
      <input type="text" autoFocus className={`${SETTINGS_INPUT} w-full`} maxLength={ROLE_MAX} value={role} placeholder="예: 백엔드 개발" onChange={(event) => setRole(event.target.value)} /></label>
    <div className="grid gap-[4px]"><span id="team-capacity" className="text-[13px] font-medium text-ink-2">함께할 사람 수</span>
      <div role="radiogroup" aria-labelledby="team-capacity" className="grid grid-cols-5 gap-[6px]">
        {CAPACITY_CHOICES.map((n) => <button type="button" role="radio" key={n} className={OPTION_CHIP} aria-checked={capacity === n} onClick={() => setCapacity(n)}>{n}명</button>)}</div></div>
    <label className="grid gap-[4px] text-[13px] font-medium text-ink-2">한 줄 소개
      <input type="text" className={`${SETTINGS_INPUT} w-full`} maxLength={INTRO_MAX} value={intro} placeholder="어떤 팀을 만들고 싶은지 적어 주세요" onChange={(event) => setIntro(event.target.value)} /></label>
    <p className={NOTE_TEXT}>모집은 공고 마감까지 열려 있어요. 연락처는 승인할 때 한 번만 물어요</p>
    {problem && (role || intro) ? <p className="m-0 text-[13px] text-ink-3" role="status">{problem}</p> : null}
    <div className="flex gap-[6px]"><button type="submit" className={SOLID_BUTTON} disabled={model.busy || !!problem}>모집 올리기</button>
      <button type="button" className={GHOST_BUTTON} onClick={onDone}>취소</button></div>
  </form>;
}

/** 공고 상세 안의 "팀원 모집" 구역. 접어 두고 개수만 보인다. 내 모집·신청이 있으면 처음부터 펼친다. */
export function TeamSection({ model }: { model: TeamModel }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const autoOpened = useRef(false);
  useEffect(() => { model.load(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!autoOpened.current && model.status === 'ready') { autoOpened.current = true; if (model.posts.some((post) => post.mine || post.myStatus)) setOpen(true); }
  }, [model.status, model.posts]);
  const live = model.posts.filter((post) => post.state === 'open').length;
  const summary = model.status === 'loading' ? '불러오는 중' : model.status === 'failed' ? '불러오지 못했어요' : live ? `모집 중 ${live}팀` : '모집 중인 팀 없음';
  return <section className={`${DETAIL_SECTION} team`} aria-labelledby="sec-team">
    <h3 id="sec-team" className={`${SECTION_TITLE} !mb-0`}>
      <button type="button" className={COLLAPSE_HEAD} aria-expanded={open} aria-controls="team-body" onClick={() => setOpen(!open)}>
        <span>팀원 모집</span><span className="flex items-center gap-[8px] font-medium">{summary}
          <svg className={`size-[16px] flex-none fill-none stroke-current [stroke-width:2] [stroke-linecap:round] [stroke-linejoin:round] ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></span></button></h3>
    {open ? <div id="team-body" className="mt-[6px] grid gap-[8px]">
      {model.status === 'failed' ? <><p className={NOTE_TEXT} role="status">팀 목록을 불러오지 못했어요</p><div><button type="button" className={GHOST_BUTTON} onClick={model.load}>다시 불러오기</button></div></> : null}
      {model.status === 'ready' && model.posts.length ? <ul className="m-0 grid list-none gap-[8px] p-0">{model.posts.map((post) => <PostCard key={post.id} model={model} post={post} />)}</ul> : null}
      {model.status === 'ready' && !model.posts.length && !creating ? <p className="m-0 text-[14px] leading-[21px] text-ink-2">이 공고로 팀을 만들어 봐요</p> : null}
      {model.status === 'ready' ? creating ? <CreateForm model={model} onDone={() => setCreating(false)} />
        : model.canCreate ? <div><button type="button" className={model.posts.length ? GHOST_BUTTON : SOLID_BUTTON} onClick={() => setCreating(true)}>팀원 모집하기</button></div> : null : null}
      {model.status === 'loading' ? <p className={NOTE_TEXT} role="status">팀을 불러오고 있어요</p> : null}
      <p className={NOTE_TEXT}>팀 참가는 직접 남기는 기록이에요. 학교가 인정하는 실적은 아니에요</p>
    </div> : null}
  </section>;
}
