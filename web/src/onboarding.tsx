// 첫 로그인 설정. 한 화면에 한 질문, 모두 골라서 답하고, 이전·건너뛰기가 항상 있다.
// 순서: 주전공 → 복수전공(선택) → 학년·재학 상태·병역 → 받을 게시판·키워드 → 기타 게시판(부트캠프 등) → 알림.
import { AiRows, aiConnectModel } from './ai-connect';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AppController } from './app-controller';
import { ADMISSION_YEARS, ENROLLMENT, MILITARY, OLD_ADMISSION_YEAR } from './profile';
import { isSoftwareOriginal, threePAnswer, threePFields, type ThreePAnswer } from './graduation-assessment';
import { COLLEGES, MAX_PROGRAMS, programKey, programLabel, type Program } from './skku-programs';
import { BOARD_CATALOG, boardsForPrograms, OTHER_BOARDS } from './skku-boards';
import {
  KEYWORD_SUGGESTIONS, STEPS, canContinue, filterDepartments, initialDraft, nextStep, previousStep,
  stepIndex, toggleValue, withPrograms, type Draft, type DoubleAnswer, type Step,
} from './onboarding-flow';
import { APP_NAME } from './brand';
import { Card, ChipGroup, ChoiceList, Segmented, SwitchRow } from './ui';

const STEP_LABELS = ['주전공', '복수전공', '학년·재학 상태', '인턴십', '받을 공지', '기타 게시판', 'AI 키', '알림'] as const;

const YEARS = [1, 2, 3, 4, 5].map((year) => ({ value: year, label: year === 5 ? '5학년 이상' : `${year}학년` }));
const STATUS = ENROLLMENT.map((value) => ({ value, label: value }));
const ADMISSION = [...ADMISSION_YEARS, OLD_ADMISSION_YEAR].map((value) => ({ value, label: value === OLD_ADMISSION_YEAR ? '2016 이전' : `${value}` }));
const THREE_P = [{ value: 'done', label: '채웠어요' }, { value: 'todo', label: '아직이에요' }, { value: 'no', label: '안 해요' }];
const DEPT_DONE = [{ value: 'yes', label: '마쳤어요' }, { value: 'no', label: '아직이에요' }];
const SERVICE = MILITARY.map((value) => ({ value, label: value }));

/** 전공 고르기: 검색 칸 하나와 대학별로 묶인 학과 목록이 한 화면에 있다. 대학을 먼저 거치지 않고 학과를 바로 누르면 고른 것이다(확정은 호출한 쪽이 한다).
 * 검색은 학과 이름이나 대학 이름 어느 쪽으로 해도 된다. 목록이 길어도 검색으로 두 글자면 한 줄만 남는다. */
export function ProgramPicker({ onPick, current, listClass = '' }: {
  onPick: (program: Program) => void; current?: Program | null; listClass?: string;
}) {
  const [query, setQuery] = useState('');
  const groups = COLLEGES.map((college) => {
    // 대학 이름이 맞으면 그 대학 학과를 모두 보여 준다.
    const all = !query.trim() || filterDepartments([college.name], query).length > 0;
    return { college, departments: all ? college.departments : filterDepartments(college.departments, query), alone: college.departments.length === 0 && all };
  }).filter((group) => group.alone || group.departments.length > 0);
  return <div className="onb-group">
    <input type="search" className="onb-search" aria-label="학과 검색" placeholder="학과나 대학 이름으로 찾기" autoComplete="off"
      value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
    <div className={`flex flex-col gap-3 ${listClass}`}>
      {groups.map(({ college, departments, alone }) => alone
        // 학과가 없는 대학(학부대학)은 그 대학 하나가 선택지다.
        ? <ChoiceList key={college.name} label={`${college.name} 선택`} selected={current?.college === college.name && !current.department ? college.name : null}
          items={[{ id: college.name, label: college.name }]} onSelect={() => onPick({ college: college.name, department: null })} />
        : <div key={college.name} className="flex flex-col gap-1">
          <p className="m-0 px-1 text-[13px] font-semibold text-ink-3">{college.name}</p>
          <ChoiceList label={`${college.name} 학과 선택`} selected={current?.college === college.name ? current.department : null}
            items={departments.map((name) => ({ id: name, label: name }))} onSelect={(name) => onPick({ college: college.name, department: name })} />
        </div>)}
      {groups.length === 0 ? <p className="hint" role="status">'{query}'에 맞는 학과가 없어요. 다른 단어로 찾아보세요.</p> : null}
    </div>
  </div>;
}

export function Onboarding({ app }: { app: AppController }) {
  useSyncExternalStore(app.subscribe, app.getVersion);
  const [step, setStep] = useState<Step>('primary');
  const [draft, setDraft] = useState<Draft>(() => initialDraft(app.profile, app.subscriptions, app.keywords));
  const [addingDouble, setAddingDouble] = useState(false);
  const [pendingDouble, setPendingDouble] = useState<Program | null>(null);
  const [doubleAnswer, setDoubleAnswer] = useState<DoubleAnswer>(() => (draft.programs.length > 1 ? 'yes' : app.profile.onboardedAt ? 'no' : null));
  const [changingPrimary, setChangingPrimary] = useState(() => app.profile.programs.length === 0);
  const [saved, setSaved] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const manual = app.onboardingManual;
  // 단계가 바뀌면 새 질문을 화면 낭독기가 읽도록 제목으로 포커스를 옮긴다.
  // 이전 화면의 스크롤 위치가 남아 제목이 가려지지 않게 맨 위로 되돌린 뒤 제목으로 포커스를 옮긴다.
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); heading.current?.focus({ preventScroll: true }); }, [step, addingDouble, changingPrimary, saved]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') app.dismissOnboarding(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  const index = stepIndex(step);
  const primary = draft.programs[0];
  const doubles = draft.programs.slice(1);
  const go = (to: Step | null) => { if (to) setStep(to); };
  const setPrimary = (program: Program) => {
    setDraft(withPrograms(draft, [program, ...doubles.filter((other) => programKey(other) !== programKey(program))]));
  };
  const addDouble = (program: Program) => {
    setDraft(withPrograms(draft, [...draft.programs.filter((other) => programKey(other) !== programKey(program)), program]));
    setAddingDouble(false);
    setPendingDouble(null);
  };
  const cancelDouble = () => {
    setAddingDouble(false);
    setPendingDouble(null);
    if (draft.programs.length < 2) setDoubleAnswer(null);
  };
  const removeDouble = (program: Program) => setDraft(withPrograms(draft, draft.programs.filter((other) => programKey(other) !== programKey(program))));
  const back = () => {
    if (addingDouble) { cancelDouble(); return; }
    if (step === 'primary' && !changingPrimary) { setChangingPrimary(true); return; }
    go(previousStep(step));
  };
  const sources = app.sources.filter((source) => !source.external);
  const recommended = boardsForPrograms(draft.programs);
  const orderedSources = [...sources].sort((a, b) => Number(recommended.includes(b.id)) - Number(recommended.includes(a.id)));
  const keywordOptions = [...KEYWORD_SUGGESTIONS, ...draft.keywords.filter((word) => !(KEYWORD_SUGGESTIONS as readonly string[]).includes(word))];
  const pushAsk = app.pushStatus === 'off';

  const afterAi = () => { if (app.pushStatus === 'off') go('notify'); else app.closeOnboarding(); };
  const save = async () => { if (await app.finishOnboarding(draft)) { setSaved(true); if (app.byokOn && !app.byokStatus && app.aiKeys.length === 0) go('ai'); else afterAi(); } };

  let title = '', lead = '', body: React.ReactNode = null, foot: React.ReactNode = null;
  if (step === 'primary') {
    title = '주전공이 어디예요?';
    body = changingPrimary || !primary
      ? <ProgramPicker current={primary} onPick={setPrimary} />
      : <div className="onb-group">
        <ChoiceList label="선택한 주전공" selected={programKey(primary)} items={[{ id: programKey(primary), label: programLabel(primary), note: primary.department ? primary.college : undefined }]} onSelect={() => undefined} />
        <button type="button" className="text-button" onClick={() => setChangingPrimary(true)}>주전공 바꾸기</button>
      </div>;
    foot = <button type="button" className="solid-button" disabled={!canContinue('primary', draft)} onClick={() => { setChangingPrimary(false); go('double'); }}>다음</button>;
  } else if (step === 'double') {
    title = '복수전공이 있나요?';
    lead = addingDouble ? '' : '있으면 그 학과 공지도 함께 받아요';
    body = addingDouble
      ? <ProgramPicker current={pendingDouble} onPick={setPendingDouble} />
      : <div className="onb-group">
        {doubles.length ? <Card id="doubles" title="복수전공">
          <dl className="info-list">{doubles.map((program) => <div key={programKey(program)}>
            <dt>{program.department ? program.college : '복수전공'}</dt>
            <dd><span>{programLabel(program)}</span>{' '}
              <button type="button" className="text-button" aria-label={`${programLabel(program)} 빼기`} onClick={() => removeDouble(program)}>빼기</button></dd>
          </div>)}</dl>
        </Card> : null}
        {draft.programs.length < MAX_PROGRAMS
          ? doubles.length
            ? <ChoiceList nav label="복수전공 추가" items={[{ id: 'add', label: '복수전공 더 추가하기' }]} onSelect={() => setAddingDouble(true)} />
            : <ChoiceList label="복수전공 선택" selected={doubleAnswer}
              items={[{ id: 'yes', label: '있어요' }, { id: 'no', label: '없어요' }]}
              onSelect={(id) => { if (id === 'no') setDoubleAnswer('no'); else { setDoubleAnswer('yes'); setAddingDouble(true); } }} /> : null}
      </div>;
    foot = addingDouble
      ? <button type="button" className="solid-button" disabled={!pendingDouble} onClick={() => { if (pendingDouble) { addDouble(pendingDouble); go('status'); } }}>다음</button>
      : <button type="button" className="solid-button" disabled={!canContinue('double', draft, doubleAnswer)} onClick={() => go('status')}>다음</button>;
  } else if (step === 'status') {
    title = '학교 정보를 알려 주세요';
    lead = '지원 자격에 맞는 공지를 고를 때만 써요';
    body = <div className="onb-group">
      <h2>학년</h2>
      <Segmented label="학년" options={YEARS} columns={3} value={draft.year} onChange={(year) => setDraft({ ...draft, year })} />
      <h2>재학 상태</h2>
      <Segmented label="재학 상태" options={STATUS} value={draft.enrollmentStatus} onChange={(enrollmentStatus) => setDraft({ ...draft, enrollmentStatus })} />
      <p className="card-note">졸업예정은 이번 학기에 졸업하는 경우, 졸업은 학위를 이미 받은 경우예요</p>
      <h2>병역</h2>
      <Segmented label="병역" options={SERVICE} columns={3} value={draft.militaryService} onChange={(militaryService) => setDraft({ ...draft, militaryService })} />
    </div>;
    foot = <button type="button" className="solid-button" disabled={!canContinue('status', draft)} onClick={() => go('internship')}>다음</button>;
  } else if (step === 'internship') {
    title = '인턴십 진행 상황을 알려 주세요';
    lead = '이미 채운 요건은 인턴 공고에서 빼 드려요';
    // 질문마다 제목이 곧 질문이다(제목 아래에 같은 말을 설명으로 되풀이하지 않는다). 입학 연도만 이유를 한 줄로 덧붙인다.
    body = <div className="onb-group">
      {isSoftwareOriginal({ programs: draft.programs }) ? <>
        <h2>입학 연도가 언제예요?</h2>
        <p className="card-note">입학 연도마다 졸업요건이 달라요. 학번 전체는 받지 않아요</p>
        <Segmented label="입학 연도" options={ADMISSION} columns={4} value={draft.admissionYear} onChange={(admissionYear) => setDraft({ ...draft, admissionYear })} />
      </> : null}
      <h2>3품 인턴십 영역을 채웠나요?</h2>
      <Segmented label="3품 인턴십" options={THREE_P} columns={3} value={threePAnswer(draft)}
        onChange={(value) => setDraft({ ...draft, ...threePFields(value as ThreePAnswer) })} />
      {isSoftwareOriginal({ programs: draft.programs }) ? <>
        <h2>솦 인턴십을 마쳤나요?</h2>
        <Segmented label="솦 인턴십" options={DEPT_DONE} columns={2}
          value={draft.deptInternshipDone === null ? null : draft.deptInternshipDone ? 'yes' : 'no'}
          onChange={(value) => setDraft({ ...draft, deptInternshipDone: value === 'yes' })} />
      </> : null}
    </div>;
    foot = <button type="button" className="solid-button" disabled={!canContinue('internship', draft)} onClick={() => go('boards')}>다음</button>;
  } else if (step === 'boards') {
    title = '어떤 공지를 받을까요?';
    lead = '고른 전공을 기준으로 켜 뒀어요';
    body = <div className="onb-group">
      <Card id="boards" title="게시판">
        {orderedSources.filter((source) => !OTHER_BOARDS.some((board) => board.id === source.id)).map((source) => <SwitchRow key={source.id} label={source.name}
          checked={draft.boards.includes(source.id)} onChange={() => setDraft({ ...draft, boards: toggleValue(draft.boards, source.id), boardsTouched: true })} />)}
        {orderedSources.length === 0 ? <p className="hint" role="status">게시판 목록을 불러오지 못했어요. 잠시 뒤 설정에서 다시 골라 주세요.</p> : null}
      </Card>
      <h2>관심 키워드</h2>
      <p className="card-note">안 골라도 모든 공지를 받아요</p>
      <ChipGroup label="관심 키워드" options={keywordOptions} selected={draft.keywords} onToggle={(word) => setDraft({ ...draft, keywords: toggleValue(draft.keywords, word) })} />
    </div>;
    foot = <button type="button" className="solid-button" onClick={() => go('etc')}>다음</button>;
  } else if (step === 'etc') {
    title = '전공과 상관없는 게시판도 받을까요?';
    lead = '필요한 것만 켜요';
    // 서버 이름을 받기 전에도 내부 id가 보이지 않게 목록의 한글 이름으로 채운다.
    const nameOf = (id: string) => sources.find((source) => source.id === id)?.name ?? BOARD_CATALOG.find((board) => board.id === id)?.name ?? OTHER_BOARDS.find((board) => board.id === id)?.name ?? id;
    body = <div className="onb-group">
      <div className="box" role="group" aria-label="기타 게시판">
        {OTHER_BOARDS.map((board) => <SwitchRow key={board.id} label={nameOf(board.id)} description={board.help}
          checked={draft.boards.includes(board.id)} onChange={() => setDraft({ ...draft, boards: toggleValue(draft.boards, board.id), boardsTouched: true })} />)}
      </div>
      {app.onboardingError ? <p className="error-text" role="alert">{app.onboardingError}</p> : null}
    </div>;
    foot = <button type="button" className="solid-button" disabled={app.onboardingBusy} onClick={() => { void save(); }}>
      {app.onboardingBusy ? '저장하고 있어요' : app.onboardingError ? '다시 시도하기' : '다음'}</button>;
  } else if (step === 'ai') {
    title = 'Gemini를 연결할까요?';
    lead = '연결하지 않아도 공지와 알림은 똑같이 써요';
    const connected = !!app.byokStatus || app.aiKeys.length > 0;
    body = <div className="onb-group"><div className="box"><AiRows byok={aiConnectModel(app)} only="gemini" /></div></div>;
    foot = connected
      ? <button type="button" className="solid-button" onClick={afterAi}>다음</button>
      : <button type="button" className="ghost-button" disabled={app.byokBusy || app.aiBusy} onClick={afterAi}>나중에 할게요</button>;
  } else {
    title = '알림을 켜 둘까요?';
    lead = '새 공지가 올라오면 이 기기로 알려드려요. 키워드와 맞지 않는 공지는 조용히 보여드려요.';
    body = <div className="onb-group">
      {app.pushError ? <p className="error-text" role="alert">{app.pushError}</p> : null}
      {app.pushStatus === 'denied' ? <p className="hint">브라우저 설정에서 알림을 허용하면 나중에 켤 수 있어요.</p> : null}
    </div>;
    foot = <>
      {pushAsk || app.pushStatus === 'busy'
        ? <button type="button" className="solid-button" disabled={app.pushStatus === 'busy'} onClick={() => { void app.enablePush().then(() => { if (app.pushStatus === 'on') app.closeOnboarding(); }); }}>
          {app.pushStatus === 'busy' ? '확인하고 있어요' : app.pushRetry ? '다시 시도하기' : '알림 받기'}</button>
        : <button type="button" className="solid-button" onClick={() => app.closeOnboarding()}>끝내기</button>}
      {pushAsk ? <button type="button" className="ghost-button" onClick={() => app.closeOnboarding()}>나중에 할게요</button> : null}
    </>;
  }

  const showBack = index > 0 || addingDouble || (step === 'primary' && !changingPrimary);
  return <div className="onb" role="dialog" aria-modal="true" aria-labelledby="onb-title">
    {/* 넓은 화면에서만 보이는 왼쪽 칸: 앱 아이콘과 이름, 설명, 단계 목록. 진행 정보는 오른쪽 progressbar가 알리므로 낭독기에서는 건너뛴다. */}
    <aside className="onb-brand" aria-hidden="true">
      <div className="onb-brand-lockup"><svg className="brand-mark"><use href="icons/sprite.svg#brand" /></svg>{APP_NAME}</div>
      <div className="onb-brand-copy">
        <h2>내 전공에 맞는 공지만<br />골라서 받아요</h2>
        <p>몇 가지만 고르면 필요한 게시판과 알림을 맞춰 드려요.</p>
      </div>
      <ol className="onb-steplist">{STEP_LABELS.map((label, i) =>
        <li key={label} data-state={i < index ? 'done' : i === index ? 'current' : 'todo'}><span className="num">{i < index ? '✓' : i + 1}</span>{label}</li>)}</ol>
    </aside>
    <div className="onb-main" ref={bodyRef}>
      <div className="onb-top">
        <div className="onb-top-inner">
          {showBack
            ? <button type="button" className="icon-button" aria-label="이전 단계" onClick={back}><svg className="i" aria-hidden="true"><use href="icons/sprite.svg#back" /></svg></button>
            : <span className="onb-top-slot" aria-hidden="true" />}
          <div className="onb-progress" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={index + 1}
            aria-valuetext={`${STEPS.length}단계 중 ${index + 1}단계`} aria-label="첫 설정 진행">
            {STEPS.map((name, i) => <span key={name} data-done={i <= index} />)}
          </div>
          {manual
            ? <button type="button" className="onb-x" aria-label="닫기" onClick={() => app.dismissOnboarding()}><svg className="i" aria-hidden="true"><use href="icons/sprite.svg#close" /></svg></button>
            : <button type="button" className="onb-skip" onClick={() => app.dismissOnboarding()}>나중에 하기</button>}
        </div>
      </div>
      <div className="onb-body min-[900px]:flex-none">
        <h1 id="onb-title" ref={heading} tabIndex={-1}>{title}</h1>
        {lead ? <p className="onb-lead">{lead}</p> : null}
        {body}
      </div>
      {foot ? <div className="onb-foot"><div className="onb-foot-inner">{foot}</div></div> : null}
    </div>
  </div>;
}
