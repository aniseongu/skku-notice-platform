// 첫 로그인 설정. 한 화면에 한 질문, 모두 골라서 답하고, 이전·건너뛰기가 항상 있다.
// 순서: 주전공 → 복수전공(선택) → 학년·재학 상태·병역 → 받을 게시판·키워드 → 기타 게시판(부트캠프 등) → 알림.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AppController } from './app-controller';
import { ADMISSION_YEARS, ENROLLMENT, MILITARY, OLD_ADMISSION_YEAR } from './profile';
import { isSoftwareOriginal, threePAnswer, threePFields, type ThreePAnswer } from './graduation-assessment';
import { COLLEGES, MAX_PROGRAMS, findCollege, programKey, programLabel, type Program } from './skku-programs';
import { BOARD_CATALOG, boardsForPrograms, OTHER_BOARDS } from './skku-boards';
import {
  KEYWORD_SUGGESTIONS, SEARCH_THRESHOLD, STEPS, canContinue, filterDepartments, initialDraft, nextStep, previousStep,
  stepIndex, toggleValue, withPrograms, type Draft, type DoubleAnswer, type Step,
} from './onboarding-flow';
import { APP_NAME } from './brand';
import { Card, ChipGroup, ChoiceList, Segmented, SwitchRow } from './ui';

const STEP_LABELS = ['주전공', '복수전공', '학년·재학 상태', '인턴십 졸업요건', '받을 공지', '기타 게시판', 'AI 키', '알림'] as const;

const YEARS = [1, 2, 3, 4, 5].map((year) => ({ value: year, label: year === 5 ? '5학년 이상' : `${year}학년` }));
const STATUS = ENROLLMENT.map((value) => ({ value, label: value }));
const ADMISSION = [...ADMISSION_YEARS, OLD_ADMISSION_YEAR].map((value) => ({ value, label: value === OLD_ADMISSION_YEAR ? '2016 이전' : `${value}` }));
const THREE_P = [{ value: 'done', label: '채웠어요' }, { value: 'todo', label: '아직이에요' }, { value: 'no', label: '이 영역은 안 해요' }];
const DEPT_DONE = [{ value: 'yes', label: '채웠어요' }, { value: 'no', label: '아직이에요' }];
const SERVICE = MILITARY.map((value) => ({ value, label: value }));

/** 대학을 고른 뒤 그 대학의 학과만 보여 준다. 대학 줄은 학과 목록으로 들어가는 이동 줄이고, 학과는 고르기만 한다(확정은 아래 "다음"). */
function ProgramPicker({ onPick, onCancel, current }: {
  onPick: (program: Program) => void; onCancel?: () => void; current?: Program | null;
}) {
  const [college, setCollege] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const found = findCollege(college);
  // 대학 목록에서 아래쪽 항목을 눌러 스크롤된 채로 학과 목록이 열려 제목이 가려지지 않게, 목록이 바뀌면 맨 위로 되돌린다.
  useEffect(() => { document.querySelector('.onb-main')?.scrollTo({ top: 0 }); }, [college]);
  if (!found) {
    return <div className="onb-group">
      <p className="onb-lead">대학을 먼저 고르면 학과가 나와요</p>
      <ChoiceList nav label="대학 선택" items={COLLEGES.map((item) => ({ id: item.name, label: item.name }))}
        onSelect={(name) => { setCollege(name); setQuery(''); }} />
      {onCancel ? <button type="button" className="text-button" onClick={onCancel}>복수전공 고르기를 취소할게요</button> : null}
    </div>;
  }
  // 학과가 없는 대학(학부대학)은 그 대학 하나만 고르는 목록이다.
  const noDepartments = found.departments.length === 0;
  const departments = filterDepartments(found.departments, query);
  return <div className="onb-group">
    {found.departments.length > SEARCH_THRESHOLD
      ? <input type="search" className="onb-search" aria-label="학과 검색" placeholder="학과 이름으로 찾기" autoComplete="off"
        value={query} onChange={(event) => setQuery(event.currentTarget.value)} /> : null}
    {noDepartments
      ? <ChoiceList label={`${found.name} 선택`} selected={current?.college === found.name ? found.name : null}
        items={[{ id: found.name, label: found.name }]} onSelect={() => onPick({ college: found.name, department: null })} />
      : departments.length
        ? <ChoiceList label={`${found.name} 학과 선택`} selected={current?.college === found.name ? current.department : null}
          items={departments.map((name) => ({ id: name, label: name }))} onSelect={(name) => onPick({ college: found.name, department: name })} />
        : <p className="hint" role="status">'{query}'에 맞는 학과가 없어요. 다른 단어로 찾아보세요.</p>}
    <button type="button" className="text-button" onClick={() => setCollege(null)}>다른 대학 고르기</button>
  </div>;
}

export function Onboarding({ app }: { app: AppController }) {
  useSyncExternalStore(app.subscribe, app.getVersion);
  const [step, setStep] = useState<Step>('primary');
  const [draft, setDraft] = useState<Draft>(() => initialDraft(app.profile, app.subscriptions, app.keywords));
  const [addingDouble, setAddingDouble] = useState(false);
  const [pendingDouble, setPendingDouble] = useState<Program | null>(null);
  const [doubleAnswer, setDoubleAnswer] = useState<DoubleAnswer>(() => (draft.programs.length > 1 ? 'yes' : null));
  const [changingPrimary, setChangingPrimary] = useState(() => app.profile.programs.length === 0);
  const [saved, setSaved] = useState(false);
  const [aiKey, setAiKey] = useState('');
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
  const save = async () => { if (await app.finishOnboarding(draft)) { setSaved(true); if (app.byokOn && !app.byokStatus) go('ai'); else afterAi(); } };

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
      ? <ProgramPicker current={pendingDouble} onPick={setPendingDouble} onCancel={cancelDouble} />
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
    title = '인턴십 졸업요건을 알려 주세요';
    lead = '이미 채운 요건은 인턴 공고에서 빼 드려요';
    body = <div className="onb-group">
      {isSoftwareOriginal({ programs: draft.programs }) ? <>
        <h2>입학 연도</h2>
        <p className="card-note">입학 연도마다 졸업요건이 달라서 물어봐요. 학번 전체는 받지 않아요</p>
        <Segmented label="입학 연도" options={ADMISSION} columns={4} value={draft.admissionYear} onChange={(admissionYear) => setDraft({ ...draft, admissionYear })} />
      </> : null}
      <h2>학교 신3품 인턴십</h2>
      <p className="card-note">글로벌·창의·AI·인턴십 중 인턴십 영역을 채웠나요? 채웠다면 인턴 공고에서 이 요건을 빼 드려요</p>
      <Segmented label="학교 신3품 인턴십" options={THREE_P} columns={3} value={threePAnswer(draft)}
        onChange={(value) => setDraft({ ...draft, ...threePFields(value as ThreePAnswer) })} />
      {isSoftwareOriginal({ programs: draft.programs }) ? <>
        <h2>학과 졸업 인턴십</h2>
        <p className="card-note">학과 졸업 인턴십을 마쳤나요? 마쳤다면 인턴 공고에서 이 요건을 빼 드려요</p>
        <Segmented label="학과 졸업 인턴십" options={DEPT_DONE} columns={2}
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
    title = 'Gemini 키가 있나요?';
    lead = '키를 넣으면 나에게 맞는 공지를 골라 알리고 요약해 드려요. 나중에 설정에서 넣어도 돼요';
    body = <div className="onb-group">
      <input className="input" type="password" autoComplete="off" spellCheck={false} aria-label="Gemini 키" placeholder="Google AI Studio에서 만든 키를 붙여 넣어요"
        value={aiKey} disabled={app.byokBusy} onChange={(event) => setAiKey(event.currentTarget.value.trim())} />
      <p className="card-note">aistudio.google.com/apikey에서 무료로 만들 수 있어요. 저장하면 Gemini에 확인한 뒤 암호화해 서버에만 보관해요</p>
      {app.byokError ? <p className="error-text" role="alert">{app.byokError}</p> : null}
    </div>;
    foot = <>
      <button type="button" className="solid-button" disabled={app.byokBusy || !aiKey} onClick={() => { void app.registerKey(aiKey).then(() => { if (app.byokStatus) afterAi(); }); }}>
        {app.byokBusy ? '확인하고 있어요' : '저장하기'}</button>
      <button type="button" className="ghost-button" disabled={app.byokBusy} onClick={afterAi}>나중에 할게요</button>
    </>;
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
      <div className="onb-body">
        <h1 id="onb-title" ref={heading} tabIndex={-1}>{title}</h1>
        {lead ? <p className="onb-lead">{lead}</p> : null}
        {body}
      </div>
      {foot ? <div className="onb-foot"><div className="onb-foot-inner">{foot}</div></div> : null}
    </div>
  </div>;
}
