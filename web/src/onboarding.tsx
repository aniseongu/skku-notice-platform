// 첫 로그인 설정. 한 화면에 한 질문, 모두 골라서 답하고, 이전·건너뛰기가 항상 있다.
// 순서: 주전공 → 복수전공(선택) → 학년·재학 상태·병역 → 받을 게시판·키워드 → 기타 게시판(부트캠프 등) → 알림.
import { boardRank } from './board-order';
import { AiRows, aiConnectModel } from './ai-connect';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AppController } from './app-controller';
import { ADMISSION_YEARS, ENROLLMENT, MILITARY, OLD_ADMISSION_YEAR } from './profile';
import { isSoftwareOriginal, threePAnswer, threePFields, type ThreePAnswer } from './graduation-assessment';
import { COLLEGES, MAX_PROGRAMS, findCollege, programKey, programLabel, type Program } from './skku-programs';
import { BOARD_CATALOG, boardCollege, boardsForPrograms, OTHER_BOARDS } from './skku-boards';
import {
  KEYWORD_SUGGESTIONS, REQUIRED_ITEMS, STEPS, STEP_LABEL, canContinue, earlierMissing, filterDepartments, initialDraft, missingHint, nextStep, previousStep,
  resumeStep, savedBefore, stepIndex, toggleValue, withPrograms, type Draft, type DoubleAnswer, type Step,
} from './onboarding-flow';
import { APP_NAME } from './brand';
import { BackToGroups, Card, ChipGroup, ChoiceList, GroupGrid, Segmented, SwitchRow } from './ui';

const STEP_LABELS = ['주전공', '복수전공', '학교 정보', '인턴십', '받을 공지', '알림', 'AI 키'] as const;

const YEARS = [1, 2, 3, 4, 5].map((year) => ({ value: year, label: year === 5 ? '5학년 이상' : `${year}학년` }));
const STATUS = ENROLLMENT.map((value) => ({ value, label: value }));
const ADMISSION = [...ADMISSION_YEARS, OLD_ADMISSION_YEAR].map((value) => ({ value, label: value === OLD_ADMISSION_YEAR ? '2016 이전' : `${value}` }));
const THREE_P = [{ value: 'done', label: '채웠어요' }, { value: 'todo', label: '아직이에요' }, { value: 'no', label: '안 해요' }];
const DEPT_DONE = [{ value: 'yes', label: '마쳤어요' }, { value: 'no', label: '아직이에요' }];
const SERVICE = MILITARY.map((value) => ({ value, label: value }));

/** 전공 고르기: 대학을 먼저 고르고 그 대학의 학과를 고른다(주전공, 복수전공 모두). 대학 줄은 학과 목록으로 들어가는 이동 줄이고, 학과는 고르기만 한다(확정은 호출한 쪽이 한다).
 * 학과 목록 맨 위에 고른 단과대와 "다른 단과대 고르기"를 둬서, 되돌아갈 때 긴 목록 아래까지 내려가지 않는다. */
function RequiredHint({ text }: { text: string }) {
  return <p className="m-0 text-center text-[14px] text-ink-2" role="status"><span className="font-semibold text-ink">필수 선택이에요</span><br /><span>{text}</span></p>;
}

export function ProgramPicker({ onPick, current, listClass = '', lead = true }: {
  onPick: (program: Program) => void; current?: Program | null; listClass?: string; lead?: boolean;
}) {
  const [college, setCollege] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const found = findCollege(college);
  const listRef = useRef<HTMLDivElement>(null);
  const searching = query.trim().length > 0;
  // 대학 목록에서 아래쪽 항목을 눌러 스크롤된 채로 학과 목록이 열려 제목이 가려지지 않게, 목록이 바뀌면 맨 위로 되돌린다.
  useEffect(() => { document.querySelector('.onb-main')?.scrollTo({ top: 0 }); listRef.current?.scrollTo({ top: 0 }); }, [college]);
  const GROUP = 'onb-group grid gap-[8px] [&>h2]:mt-[16px] [&>h2]:text-[15px] [&>h2]:leading-[22px] [&>h2]:font-semibold [&>h2]:text-ink [&>h2:first-child]:mt-0 [&>h2:not(:first-child)]:mt-[24px]';
  // 검색 칸은 처음부터 보이고, 모든 단과대의 학과를 한 번에 찾는다. 단과대를 먼저 고르지 않아도 된다.
  const search = <input type="search" className="onb-search min-h-[44px] rounded-md border border-line bg-surface px-[12px] py-0 text-ink placeholder:text-ink-3" aria-label="학과 검색" placeholder="학과 이름으로 찾기" autoComplete="off"
    value={query} onChange={(event) => setQuery(event.currentTarget.value)} />;
  if (searching) {
    const results = COLLEGES.flatMap((item) => {
      if (item.departments.length === 0) return filterDepartments([item.name], query).map(() => ({ college: item.name, department: null as string | null }));
      return filterDepartments(item.departments, query).map((department) => ({ college: item.name, department }));
    });
    const selectedId = current ? `${current.college}/${current.department ?? ''}` : null;
    return <div className={GROUP}>
      {search}
      <div ref={listRef} className={listClass}>
        {results.length
          ? <ChoiceList label="학과 검색 결과" selected={selectedId}
            items={results.map((item) => ({ id: `${item.college}/${item.department ?? ''}`, label: item.department ?? item.college, note: item.department ? item.college : undefined }))}
            onSelect={(id) => { const hit = results.find((item) => `${item.college}/${item.department ?? ''}` === id); if (hit) onPick(hit); }} />
          : <p className="hint rounded-md bg-sunken px-[12px] py-[10px] text-[14px] text-ink-2" role="status">'{query}'에 맞는 학과가 없어요. 다른 단어로 찾아보세요.</p>}
      </div>
    </div>;
  }
  if (!found) {
    return <div className={GROUP}>
      {search}
      <div ref={listRef} className={listClass}>
        <GroupGrid label="단과대 선택" names={COLLEGES.map((item) => item.name)} onPick={(name) => { setCollege(name); setQuery(''); }} />
      </div>
    </div>;
  }
  // 학과가 없는 대학(학부대학)은 그 대학 하나만 고르는 목록이다.
  const noDepartments = found.departments.length === 0;
  return <div className={GROUP}>
    {search}
    <BackToGroups current={found.name} onBack={() => setCollege(null)} />
    <div ref={listRef} className={listClass}>
      {noDepartments
        ? <ChoiceList label={`${found.name} 선택`} selected={current?.college === found.name ? found.name : null}
          items={[{ id: found.name, label: found.name }]} onSelect={() => onPick({ college: found.name, department: null })} />
        : <ChoiceList label={`${found.name} 학과 선택`} selected={current?.college === found.name ? current.department : null}
          items={found.departments.map((name) => ({ id: name, label: name }))} onSelect={(name) => onPick({ college: found.name, department: name })} />}
    </div>
  </div>;
}

/** 첫 설정의 "게시판 더 보기": 설정의 게시판 더 보기와 같은 방식이다. 검색 칸과 단과대 격자를 먼저 보이고, 단과대를 누르면 그 단과대의 게시판 스위치가 나온다.
 * 58개를 한 줄씩 늘어놓으면 찾기 어렵고 스크롤이 길다(토스 기준: 긴 목록은 검색 + 묶음). 격자에는 단과대마다 켠 게시판 수를 적는다. */
/** 남은 게시판이 이 수 이하면 "더 보기" 없이 위 목록에 바로 둔다. */
const INLINE_REST = 3;
/** 펼친 "더 보기"가 이 수 이하면 검색·단과대 격자 없이 스위치만 보인다(한 화면에 들어오는 길이). */
const FEW_BOARDS = 8;

function MoreBoards<T extends { id: string; name: string }>({ sources, on, render }: { sources: readonly T[]; on: readonly string[]; render: (source: T) => React.ReactNode }) {
  const [group, setGroup] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const known = new Set(BOARD_CATALOG.map((board) => board.id));
  const groups = new Map<string, T[]>();
  for (const source of sources) {
    const name = boardCollege(source.id) ?? (known.has(source.id) ? '기타' : '학교 공통');
    groups.set(name, [...(groups.get(name) ?? []), source]);
  }
  const order = COLLEGES.map((college) => college.name);
  const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : 100 + Number(name === '학교 공통'));
  const names = [...groups.keys()].sort((a, b) => rank(a) - rank(b));
  // 켠 개수는 위 목록에서 이미 켜 둔 내 전공 게시판까지 센다(단과대 칸만 보고도 무엇을 받는지 알게).
  const countOn = (name: string) => (order.includes(name) ? on.filter((id) => boardCollege(id) === name).length : (groups.get(name) ?? []).filter((source) => on.includes(source.id)).length);
  const notes = Object.fromEntries(names.map((name) => [name, countOn(name)]).filter(([, count]) => count).map(([name, count]) => [name, `${count}개 켜짐`]));
  const needle = query.replace(/\s+/g, '').toLowerCase();
  const found = needle ? sources.filter((source) => source.name.replace(/\s+/g, '').toLowerCase().includes(needle)) : [];
  // 묶음이 하나뿐이면 고를 것이 없으니 격자와 "다른 단과대 고르기" 없이 바로 그 묶음을 보인다.
  const only = names.length === 1 ? names[0] : null;
  const current = only ?? (group && groups.has(group) ? group : null);
  const list = 'box rounded-lg bg-surface px-[var(--gutter)] min-[720px]:rounded-none min-[720px]:border-t min-[720px]:border-line min-[720px]:bg-transparent min-[720px]:p-0';
  // 몇 개뿐이면 검색 칸과 단과대 격자 없이 바로 스위치를 보인다(찾을 필요가 없는 길이).
  if (sources.length <= FEW_BOARDS) return <div className={list} role="group" aria-label="더 많은 게시판">{sources.map(render)}</div>;
  return <div className="grid gap-[8px] pt-[4px]">
    <input type="search" className="min-h-[44px] rounded-md border border-line bg-surface px-[12px] py-0 text-ink placeholder:text-ink-3" aria-label="게시판 검색" placeholder="학과나 단과대 이름으로 찾기" autoComplete="off"
      value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
    {needle
      ? found.length
        ? <div className={list} role="group" aria-label="검색 결과">{found.map(render)}</div>
        : <p className="hint rounded-md bg-sunken px-[12px] py-[10px] text-[14px] text-ink-2" role="status">'{query}'에 맞는 게시판이 없어요. 다른 단어로 찾아보세요.</p>
      : current
        ? <>
          {only ? null : <BackToGroups current={current} noun={order.includes(current) ? '단과대' : '묶음'} onBack={() => setGroup(null)} />}
          <div className={list} role="group" aria-label={`${current} 게시판`}>{(groups.get(current) ?? []).map(render)}</div>
        </>
        : <GroupGrid label="단과대 선택" names={names} notes={notes} onPick={setGroup} />}
  </div>;
}

export function Onboarding({ app }: { app: AppController }) {
  useSyncExternalStore(app.subscribe, app.getVersion);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(app.profile, app.subscriptions, app.keywords));
  // 저장까지 하고 AI 키 단계에서 나간 사람은 답한 질문을 다시 거치지 않고 AI 키 단계부터 잇는다.
  // 이미 첫 설정을 끝낸 계정(isFill)이 새로 필요한 정보 때문에 열면, 비어 있는 항목(REQUIRED_ITEMS 기준)만 순서대로 보인다.
  const [isFill] = useState(() => !!app.profile.onboardedAt);
  const [fill, setFill] = useState<Step[]>(() => (app.profile.onboardedAt ? app.missingRequiredSteps() : []));
  const fillMode = isFill && fill.length > 0;
  const [step, setStep] = useState<Step>(() => (fill.length && app.profile.onboardedAt ? fill[0] : resumeStep(app.profile, draft)));
  // 채우는 중에 키를 불러와 새로 빈 항목이 드러나면 목록에 더한다. 채운 항목은 목록에 남아 진행이 되돌아가지 않는다.
  const missingNow = isFill ? app.missingRequiredSteps() : [];
  const missingKey = missingNow.join();
  useEffect(() => {
    if (!isFill) return;
    app.holdOnboarding();
    const add = missingNow.filter((name) => !fill.includes(name));
    if (add.length) setFill(REQUIRED_ITEMS.map((item) => item.step).filter((name) => fill.includes(name) || add.includes(name)));
  }, [missingKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [addingDouble, setAddingDouble] = useState(false);
  const [pendingDouble, setPendingDouble] = useState<Program | null>(null);
  const [doubleAnswer, setDoubleAnswer] = useState<DoubleAnswer>(() => (draft.programs.length > 1 ? 'yes' : app.profile.onboardedAt || savedBefore(app.profile) ? 'no' : null));
  const [changingPrimary, setChangingPrimary] = useState(() => app.profile.programs.length === 0);
  const [saved, setSaved] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  // "더 보기"를 펼치면 펼친 목록의 첫 부분(검색 칸)이 화면 안에 들어오게 한다.
  useEffect(() => { if (moreOpen) moreRef.current?.firstElementChild?.scrollIntoView({ block: 'nearest' }); }, [moreOpen]);
  const heading = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // 단계가 바뀌면 새 질문을 화면 낭독기가 읽도록 제목으로 포커스를 옮긴다.
  // 이전 화면의 스크롤 위치가 남아 제목이 가려지지 않게 맨 위로 되돌린 뒤 제목으로 포커스를 옮긴다.
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); heading.current?.focus({ preventScroll: true }); }, [step, addingDouble, changingPrimary, saved]);
  // AI 키 단계에 들어오면 키 기능이 켜져 있는지 한 번 더 확인한다(처음 확인이 실패했어도 여기서 이어진다).
  useEffect(() => { if (step === 'ai' && !app.byokOn) void app.recheckByok(); }, [step, app]);

  const index = fillMode ? fill.indexOf(step) : stepIndex(step);
  const primary = draft.programs[0];
  const doubles = draft.programs.slice(1);
  // 채우는 화면에서는 어느 단계로 가라는 요청이든 "다음 빈 항목"으로 간다. 프로필 항목은 마지막 프로필 항목에서 한 번에 저장하고, 끝이면 닫는다.
  const nextFill = fillMode ? fill[index + 1] : undefined;
  const advanceFill = async () => {
    const laterProfile = fill.slice(index + 1).some((name) => name !== 'ai');
    if (step !== 'ai' && !laterProfile && !(await app.saveMissingProfile(draft, !nextFill))) return;
    if (nextFill) setStep(nextFill);
  };
  const go = (to: Step | null) => { if (!to) return; if (fillMode) void advanceFill(); else setStep(to); };
  // 앞 단계에 필수 답이 비어 있으면(새 필수 항목이 생겼을 때 등) 이 단계는 넘어가지 않고 그 단계로 돌아가게 한다.
  const blocked = fillMode ? null : earlierMissing(step, draft, doubleAnswer);
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
    // 앞으로 갈 때 알림이 이미 켜져 있어 건너뛴 단계는 뒤로 갈 때도 건너뛴다.
    if (fillMode) { if (index > 0) setStep(fill[index - 1]); return; }
    if (step === 'ai' && app.pushStatus !== 'off') { go('boards'); return; }
    go(previousStep(step));
  };
  const sources = app.sources.filter((source) => !source.external);
  const recommended = boardsForPrograms(draft.programs);
  // 성균관대 > 대학 > 학과 > 기타 순으로 놓고, 같은 구분 안에서는 고른 전공에 맞는 게시판을 먼저 둔다.
  const orderedSources = [...sources].sort((a, b) => boardRank(a) - boardRank(b) || Number(recommended.includes(b.id)) - Number(recommended.includes(a.id)));
  // 켜 둔 게시판(고른 전공에 맞는 것과 이미 고른 것)만 먼저 보이고, 나머지는 "게시판 더 보기"에 접어 둔다. 기타 게시판과 키워드가 길게 스크롤하지 않아도 보이게 한다.
  const [initialBoards] = useState(() => draft.boards);
  const mainSources = orderedSources.filter((source) => !OTHER_BOARDS.some((board) => board.id === source.id));
  const shownBoards = new Set([...recommended, ...initialBoards]);
  // 남은 게시판이 몇 개뿐이면 "더 보기"로 접지 않고 위 목록에 꺼진 채로 바로 둔다(한 번 더 누르게 하지 않는다).
  const restSources = mainSources.filter((source) => !shownBoards.has(source.id));
  const inlineRest = restSources.length <= INLINE_REST;
  const moreSources = inlineRest ? [] : restSources;
  const boardSwitch = (source: (typeof mainSources)[number]) => <SwitchRow key={source.id} label={source.name}
    checked={draft.boards.includes(source.id)} onChange={() => setDraft({ ...draft, boards: toggleValue(draft.boards, source.id), boardsTouched: true })} />;
  const keywordOptions = [...KEYWORD_SUGGESTIONS, ...draft.keywords.filter((word) => !(KEYWORD_SUGGESTIONS as readonly string[]).includes(word))];
  const pushAsk = app.pushStatus === 'off';

  // 알림 → AI 키 순서. 알림을 이미 켰거나 지원하지 않으면 알림 단계를 건너뛰고, 키가 이미 있으면 AI 단계를 건너뛴다.
  // 키 기능이 꺼져 있거나 확인하지 못했어도 키 없이 끝내지 않는다(예외 없음). 그때는 AI 단계에서 다시 확인하게 한다.
  const needAi = () => !app.byokStatus && app.aiKeys.length === 0;
  const afterNotify = () => { if (needAi()) go('ai'); else app.closeOnboarding(); };
  const finishWithKey = () => { void app.completeOnboarding(); };
  const save = async () => { if (await app.finishOnboarding(draft, !needAi())) { setSaved(true); if (app.pushStatus === 'off') go('notify'); else afterNotify(); } };

  let title = '', lead = '', body: React.ReactNode = null, foot: React.ReactNode = null;
  if (step === 'primary') {
    title = '주전공이 어디예요?';
    body = changingPrimary || !primary
      ? <ProgramPicker current={primary} onPick={setPrimary} />
      : <div className="onb-group grid gap-[8px] [&>h2]:mt-[16px] [&>h2]:text-[15px] [&>h2]:leading-[22px] [&>h2]:font-semibold [&>h2]:text-ink [&>h2:first-child]:mt-0 [&>h2:not(:first-child)]:mt-[24px]">
        <ChoiceList label="선택한 주전공" selected={programKey(primary)} items={[{ id: programKey(primary), label: programLabel(primary), note: primary.department ? primary.college : undefined }]} onSelect={() => undefined} />
        <button type="button" className="text-button [@media(hover:hover)]:hover:text-ink active:text-ink self-start px-0 py-[10px] border-0 bg-transparent text-ink-2 text-[14px] font-semibold underline underline-offset-[3px]" onClick={() => setChangingPrimary(true)}>주전공 바꾸기</button>
      </div>;
    foot = <button type="button" className="solid-button [@media(hover:hover)]:hover:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] active:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] inline-flex items-center justify-center min-h-[44px] px-[16px] py-0 rounded-md border-0 bg-accent text-on-accent text-[15px] font-semibold no-underline whitespace-nowrap select-none [-webkit-user-select:none] disabled:border disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60" disabled={!canContinue('primary', draft)} onClick={() => { setChangingPrimary(false); go('double'); }}>다음</button>;
  } else if (step === 'double') {
    title = '복수전공이 있나요?';
    lead = addingDouble ? '' : '있으면 그 학과 공지도 함께 받아요';
    body = addingDouble
      ? <ProgramPicker current={pendingDouble} onPick={setPendingDouble} />
      : <div className="onb-group grid gap-[8px] [&>h2]:mt-[16px] [&>h2]:text-[15px] [&>h2]:leading-[22px] [&>h2]:font-semibold [&>h2]:text-ink [&>h2:first-child]:mt-0 [&>h2:not(:first-child)]:mt-[24px]">
        {doubles.length ? <Card id="doubles" title="복수전공">
          <dl className="info-list m-0 grid gap-[2px] [&>div]:flex [&>div]:justify-between [&>div]:gap-[12px] [&>div]:py-[6px] [&>div]:text-[14px] [&_dt]:flex-none [&_dt]:text-ink-3 [&_dd]:m-0 [&_dd]:text-right [&_dd]:font-semibold [&_dd]:text-ink">{doubles.map((program) => <div key={programKey(program)}>
            <dt>{program.department ? program.college : '복수전공'}</dt>
            <dd><span>{programLabel(program)}</span>{' '}
              <button type="button" className="text-button [@media(hover:hover)]:hover:text-ink active:text-ink self-start px-0 py-[10px] border-0 bg-transparent text-ink-2 text-[14px] font-semibold underline underline-offset-[3px]" aria-label={`${programLabel(program)} 빼기`} onClick={() => removeDouble(program)}>빼기</button></dd>
          </div>)}</dl>
        </Card> : null}
        {draft.programs.length < MAX_PROGRAMS
          ? doubles.length
            ? <ChoiceList nav label="복수전공 추가" items={[{ id: 'add', label: '복수전공 더 추가하기' }]} onSelect={() => setAddingDouble(true)} />
            : <ChoiceList label="복수전공 선택" selected={doubleAnswer}
              items={[{ id: 'yes', label: '있어요' }, { id: 'no', label: '없어요' }]}
              onSelect={(id) => { if (id === 'no') { setDoubleAnswer('no'); go('status'); } else { setDoubleAnswer('yes'); setAddingDouble(true); } }} /> : null}
      </div>;
    foot = addingDouble
      ? <button type="button" className="solid-button [@media(hover:hover)]:hover:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] active:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] inline-flex items-center justify-center min-h-[44px] px-[16px] py-0 rounded-md border-0 bg-accent text-on-accent text-[15px] font-semibold no-underline whitespace-nowrap select-none [-webkit-user-select:none] disabled:border disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60" disabled={!pendingDouble} onClick={() => { if (pendingDouble) { addDouble(pendingDouble); go('status'); } }}>다음</button>
      : <button type="button" className="solid-button [@media(hover:hover)]:hover:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] active:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] inline-flex items-center justify-center min-h-[44px] px-[16px] py-0 rounded-md border-0 bg-accent text-on-accent text-[15px] font-semibold no-underline whitespace-nowrap select-none [-webkit-user-select:none] disabled:border disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60" disabled={!canContinue('double', draft, doubleAnswer)} onClick={() => go('status')}>다음</button>;
  } else if (step === 'status') {
    title = '학교 정보를 알려 주세요';
    body = <div className="onb-group grid gap-[8px] [&>h2]:mt-[16px] [&>h2]:text-[15px] [&>h2]:leading-[22px] [&>h2]:font-semibold [&>h2]:text-ink [&>h2:first-child]:mt-0 [&>h2:not(:first-child)]:mt-[24px]">
      <h2>학년</h2>
      <Segmented label="학년" options={YEARS} columns={3} value={draft.year} onChange={(year) => setDraft({ ...draft, year })} />
      <h2>재학 상태</h2>
      <Segmented label="재학 상태" options={STATUS} columns={4} value={draft.enrollmentStatus} onChange={(enrollmentStatus) => setDraft({ ...draft, enrollmentStatus })} />
      <p className="card-note m-0 text-[14px] text-ink-2">졸업예정은 이번 학기에 졸업하는 경우예요</p>
      <h2>병역 (선택)</h2>
      <Segmented label="병역" options={SERVICE} columns={3} value={draft.militaryService} onChange={(militaryService) => setDraft({ ...draft, militaryService })} />
    </div>;
    foot = <button type="button" className="solid-button [@media(hover:hover)]:hover:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] active:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] inline-flex items-center justify-center min-h-[44px] px-[16px] py-0 rounded-md border-0 bg-accent text-on-accent text-[15px] font-semibold no-underline whitespace-nowrap select-none [-webkit-user-select:none] disabled:border disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60" disabled={!canContinue('status', draft)} onClick={() => go('internship')}>다음</button>;
  } else if (step === 'internship') {
    const software = isSoftwareOriginal({ programs: draft.programs });
    // 질문이 하나뿐이면 제목이 곧 질문이다(제목, 부제, 질문 세 겹으로 쓰지 않는다).
    title = software ? '인턴십 진행 상황을 알려 주세요' : '3품 인턴십 영역을 채웠나요?';
    lead = '이미 채운 요건은 인턴 공고에서 빼 드려요';
    body = <div className="onb-group grid gap-[8px] [&>h2]:mt-[16px] [&>h2]:text-[15px] [&>h2]:leading-[22px] [&>h2]:font-semibold [&>h2]:text-ink [&>h2:first-child]:mt-0 [&>h2:not(:first-child)]:mt-[24px]">
      {software ? <>
        <h2>입학 연도가 언제예요?</h2>
        <p className="card-note m-0 text-[14px] text-ink-2">입학 연도마다 졸업요건이 달라요. 입학 연도만 저장해요</p>
        <Segmented label="입학 연도" options={ADMISSION} columns={4} value={draft.admissionYear} onChange={(admissionYear) => setDraft({ ...draft, admissionYear })} />
      </> : null}
      {software ? <h2>3품 인턴십 영역을 채웠나요?</h2> : null}
      <Segmented label="3품 인턴십" options={THREE_P} columns={3} value={threePAnswer(draft)}
        onChange={(value) => setDraft({ ...draft, ...threePFields(value as ThreePAnswer) })} />
      {software ? <>
        <h2>솦 인턴십을 마쳤나요?</h2>
        <Segmented label="솦 인턴십" options={DEPT_DONE} columns={2}
          value={draft.deptInternshipDone === null ? null : draft.deptInternshipDone ? 'yes' : 'no'}
          onChange={(value) => setDraft({ ...draft, deptInternshipDone: value === 'yes' })} />
      </> : null}
    </div>;
    foot = <button type="button" className="solid-button [@media(hover:hover)]:hover:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] active:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] inline-flex items-center justify-center min-h-[44px] px-[16px] py-0 rounded-md border-0 bg-accent text-on-accent text-[15px] font-semibold no-underline whitespace-nowrap select-none [-webkit-user-select:none] disabled:border disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60" disabled={!canContinue('internship', draft)} onClick={() => go('boards')}>다음</button>;
  } else if (step === 'boards') {
    title = '어떤 공지를 받을까요?';
    // 서버 이름을 받기 전에도 내부 id가 보이지 않게 목록의 한글 이름으로 채운다.
    const nameOf = (id: string) => sources.find((source) => source.id === id)?.name ?? BOARD_CATALOG.find((board) => board.id === id)?.name ?? OTHER_BOARDS.find((board) => board.id === id)?.name ?? id;
    body = <div className="onb-group grid gap-[8px] [&>h2]:mt-[16px] [&>h2]:text-[15px] [&>h2]:leading-[22px] [&>h2]:font-semibold [&>h2]:text-ink [&>h2:first-child]:mt-0 [&>h2:not(:first-child)]:mt-[24px]">
      <h2>게시판</h2>
      {/* 설명은 구역 제목 아래 한 줄, 화면에 한 번만(제목 아래 부제와 기타 게시판 설명에서 같은 말을 되풀이하지 않는다). */}
      {draft.programs.length ? <p className="card-note m-0 text-[14px] text-ink-2">내 전공에 맞는 게시판은 미리 켜 뒀어요</p> : null}
      <div className="box rounded-lg bg-surface px-[var(--gutter)] min-[720px]:rounded-none min-[720px]:border-t min-[720px]:border-line min-[720px]:bg-transparent min-[720px]:p-0" role="group" aria-label="게시판">
        {mainSources.filter((source) => shownBoards.has(source.id) || inlineRest).map(boardSwitch)}
        {/* "더 보기"는 같은 카드의 마지막 줄이다. 카드 밖에 따로 떠 있으면 구역 제목처럼 읽힌다(독립 평가). 펼친 목록은 카드 바로 아래에 둔다. */}
        {moreSources.length ? <button type="button" aria-expanded={moreOpen} aria-controls="more-boards" onClick={() => setMoreOpen(!moreOpen)}
          className="flex min-h-[52px] w-full items-center justify-between gap-[12px] border-0 border-t border-line bg-transparent px-0 text-left text-[15px] font-medium text-ink [.box>&:first-child]:border-t-0">
          {moreOpen ? '게시판 접기' : `학과·단과대 게시판 ${moreSources.length}개 더 보기`}
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`text-ink-3 transition-transform ${moreOpen ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6" /></svg>
        </button> : null}
        {orderedSources.length === 0 ? <p className="hint rounded-md bg-sunken px-[12px] py-[10px] text-[14px] text-ink-2" role="status">게시판 목록을 불러오지 못했어요. 잠시 뒤 설정에서 다시 골라 주세요.</p> : null}
      </div>
      {moreSources.length && moreOpen ? <div id="more-boards" ref={moreRef}><MoreBoards sources={moreSources} on={draft.boards} render={boardSwitch} /></div> : null}
      <h2>기타 게시판</h2>
      <p className="card-note m-0 text-[14px] text-ink-2">필요한 게시판만 켜요</p>
      <div className="box rounded-lg bg-surface px-[var(--gutter)] min-[720px]:rounded-none min-[720px]:border-t min-[720px]:border-line min-[720px]:bg-transparent min-[720px]:p-0" role="group" aria-label="기타 게시판">
        {[...new Set(OTHER_BOARDS.map((board) => board.group))]
          .sort((a, b) => Number(OTHER_BOARDS.some((board) => board.group === b && recommended.includes(board.id))) - Number(OTHER_BOARDS.some((board) => board.group === a && recommended.includes(board.id))))   // 추천이 든 묶음을 위로
          .map((group, index) => <div key={group} role="group" aria-labelledby={`other-${index}`} className="border-t border-line first:border-t-0 [&>h3+button]:border-t-0">
            <h3 id={`other-${index}`} className="m-0 pt-[14px] pb-[2px] text-[13px] font-semibold leading-[20px] text-ink-2 min-[720px]:pt-[16px]">{group}</h3>
            {OTHER_BOARDS.filter((board) => board.group === group).sort((a, b) => Number(recommended.includes(b.id)) - Number(recommended.includes(a.id))).map((board) => <SwitchRow key={board.id} label={nameOf(board.id)} description={board.help}
                  checked={draft.boards.includes(board.id)} onChange={() => setDraft({ ...draft, boards: toggleValue(draft.boards, board.id), boardsTouched: true })} />)}
          </div>)}
      </div>
      <h2>관심 키워드</h2>
      <p className="card-note m-0 text-[14px] text-ink-2">고르지 않으면 켠 게시판의 공지를 모두 받아요</p>
      <ChipGroup label="관심 키워드" options={keywordOptions} selected={draft.keywords} onToggle={(word) => setDraft({ ...draft, keywords: toggleValue(draft.keywords, word) })} />
      {app.onboardingError ? <p className="error-text text-[14px] text-danger" role="alert">{app.onboardingError}</p> : null}
    </div>;
    foot = <button type="button" className="solid-button [@media(hover:hover)]:hover:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] active:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] inline-flex items-center justify-center min-h-[44px] px-[16px] py-0 rounded-md border-0 bg-accent text-on-accent text-[15px] font-semibold no-underline whitespace-nowrap select-none [-webkit-user-select:none] disabled:border disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60" disabled={app.onboardingBusy} onClick={() => { void save(); }}>
      {app.onboardingBusy ? '저장하고 있어요' : app.onboardingError ? '다시 시도하기' : '다음'}</button>;
  } else if (step === 'ai') {
    title = 'AI를 연결해 주세요';
    const connected = fillMode ? app.hasUsableAiKey() === true : !!app.byokStatus || app.aiKeys.length > 0;
    body = <div className="onb-group grid gap-[8px] [&>h2]:mt-[16px] [&>h2]:text-[15px] [&>h2]:leading-[22px] [&>h2]:font-semibold [&>h2]:text-ink [&>h2:first-child]:mt-0 [&>h2:not(:first-child)]:mt-[24px]"><div className="box rounded-lg bg-surface px-[var(--gutter)] min-[720px]:rounded-none min-[720px]:border-t min-[720px]:border-line min-[720px]:bg-transparent min-[720px]:p-0 min-[720px]:[&_.setting]:grid-cols-[minmax(0,1fr)] min-[720px]:[&_.setting]:gap-[8px]"><AiRows byok={aiConnectModel(app)} /></div>
      {app.byokOn ? null : <button type="button" className="ghost-button [@media(hover:hover)]:hover:bg-hover active:bg-hover inline-flex items-center justify-center min-h-[44px] px-[16px] py-0 rounded-md border border-line bg-surface text-ink text-[15px] font-semibold whitespace-nowrap self-start" onClick={() => { void app.recheckByok(); }}>다시 확인하기</button>}
      {app.onboardingError ? <p className="error-text text-[14px] text-danger" role="alert">{app.onboardingError}</p> : null}</div>;
    foot = <>
      {connected ? null : <RequiredHint text="키를 하나 연결해 주세요" />}
      <button type="button" className="solid-button [@media(hover:hover)]:hover:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] active:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] inline-flex items-center justify-center min-h-[44px] px-[16px] py-0 rounded-md border-0 bg-accent text-on-accent text-[15px] font-semibold no-underline whitespace-nowrap select-none [-webkit-user-select:none] disabled:border disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60" disabled={!connected || app.onboardingBusy || app.byokBusy || app.aiBusy} onClick={nextFill ? () => setStep(nextFill) : finishWithKey}>
        {app.onboardingBusy ? '저장하고 있어요' : '끝내기'}</button>
    </>;
  } else {
    title = '알림을 켜 둘까요?';
    lead = '새 공지가 올라오면 이 기기로 알려드려요. 키워드와 맞지 않는 공지는 조용히 보여드려요.';
    body = <div className="onb-group grid gap-[8px] [&>h2]:mt-[16px] [&>h2]:text-[15px] [&>h2]:leading-[22px] [&>h2]:font-semibold [&>h2]:text-ink [&>h2:first-child]:mt-0 [&>h2:not(:first-child)]:mt-[24px]">
      {app.pushError ? <p className="error-text text-[14px] text-danger" role="alert">{app.pushError}</p> : null}
      {app.pushStatus === 'denied' ? <p className="hint rounded-md bg-sunken px-[12px] py-[10px] text-[14px] text-ink-2">브라우저 설정에서 알림을 허용하면 나중에 켤 수 있어요.</p> : null}
    </div>;
    foot = <>
      {pushAsk || app.pushStatus === 'busy'
        ? <button type="button" className="solid-button [@media(hover:hover)]:hover:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] active:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] inline-flex items-center justify-center min-h-[44px] px-[16px] py-0 rounded-md border-0 bg-accent text-on-accent text-[15px] font-semibold no-underline whitespace-nowrap select-none [-webkit-user-select:none] disabled:border disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60" disabled={app.pushStatus === 'busy'} onClick={() => { void app.enablePush().then(() => { if (app.pushStatus === 'on') afterNotify(); }); }}>
          {app.pushStatus === 'busy' ? '확인하고 있어요' : app.pushRetry ? '다시 시도하기' : '알림 받기'}</button>
        : <button type="button" className="solid-button [@media(hover:hover)]:hover:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] active:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] inline-flex items-center justify-center min-h-[44px] px-[16px] py-0 rounded-md border-0 bg-accent text-on-accent text-[15px] font-semibold no-underline whitespace-nowrap select-none [-webkit-user-select:none] disabled:border disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60" onClick={afterNotify}>{needAi() ? '다음' : '끝내기'}</button>}
      {pushAsk ? <button type="button" className="ghost-button [@media(hover:hover)]:hover:bg-hover active:bg-hover inline-flex items-center justify-center min-h-[44px] px-[16px] py-0 rounded-md border border-line bg-surface text-ink text-[15px] font-semibold no-underline whitespace-nowrap select-none [-webkit-user-select:none] disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60" onClick={afterNotify}>나중에 할게요</button> : null}
    </>;
  }

  if (fillMode) {
    if (step === 'ai') {
      const broken = !!app.byokStatus?.disabled || app.aiKeys.some((key) => key.disabled);
      title = broken ? 'AI 키를 다시 연결해 주세요' : 'AI 키를 연결해 주세요';
      lead = broken ? '연결해 둔 키가 더 이상 작동하지 않아서 다시 열었어요' : '연결된 AI 키가 없어서 다시 열었어요. 키를 연결하면 바로 이어서 써요';
    } else lead = index === 0 ? '새로 필요한 정보가 생겼어요. 이것만 고르면 바로 쓸 수 있어요' : '';
  }
  const showBack = fillMode ? index > 0 || addingDouble || (step === 'primary' && !changingPrimary) : index > 0 || addingDouble || (step === 'primary' && !changingPrimary);
  return <div className="onb fixed inset-0 z-[60] grid grid-cols-[minmax(0,1fr)] bg-bg text-ink min-[900px]:grid-cols-[minmax(320px,5fr)_minmax(0,7fr)] [&_.seg_button]:rounded-pill [&_.chip]:min-h-[44px] [&_.chip]:before:inset-0 [&_.text-button]:min-h-[44px] [&_.choice:focus-visible]:[outline-offset:-2px]" role="dialog" aria-modal="true" aria-labelledby="onb-title">
    {/* 넓은 화면에서만 보이는 왼쪽 칸: 앱 아이콘과 이름, 설명, 단계 목록. 진행 정보는 오른쪽 progressbar가 알리므로 낭독기에서는 건너뛴다. */}
    <aside className="onb-brand hidden min-[900px]:flex min-[900px]:flex-col min-[900px]:justify-between min-[900px]:gap-[32px] min-[900px]:border-r min-[900px]:border-line min-[900px]:bg-[color-mix(in_oklch,var(--accent)_8%,var(--bg))] min-[900px]:pt-[40px] min-[900px]:pr-[44px] min-[900px]:pb-[48px] min-[900px]:pl-[44px]" aria-hidden="true">
      <div className="onb-brand-lockup flex items-center gap-[10px] text-[17px] font-bold tracking-[-0.02em]"><svg className="brand-mark size-[32px] text-accent"><use href="icons/sprite.svg#brand" /></svg>{APP_NAME}</div>
      <div className="onb-brand-copy grid gap-[10px]">
        <h2 className="m-0 text-[22px] leading-[30px] font-bold tracking-[-0.02em]">내 전공에 맞는 공지만<br />골라서 받아요</h2>
        <p className="m-0 text-[15px] text-ink-2">몇 가지만 고르면 필요한 게시판과 알림을 맞춰 드려요.</p>
      </div>
      <ol className="onb-steplist m-0 grid list-none gap-[14px] p-0">{STEP_LABELS.map((label, i) =>
        <li className="flex items-center gap-[12px] text-[15px] text-ink-3 data-[state=current]:font-bold data-[state=current]:text-ink data-[state=done]:text-ink-2 data-[state=current]:[&_.num]:border-accent data-[state=current]:[&_.num]:bg-accent data-[state=current]:[&_.num]:text-on-accent data-[state=done]:[&_.num]:border-accent data-[state=done]:[&_.num]:text-accent" key={label} data-state={i < stepIndex(step) ? 'done' : i === stepIndex(step) ? 'current' : 'todo'}><span className="num inline-grid size-[28px] flex-none place-items-center rounded-[50%] border-[1.5px] border-line bg-surface text-[13px] font-bold">{i < stepIndex(step) ? '✓' : i + 1}</span>{label}</li>)}</ol>
    </aside>
    <div className="onb-main flex min-h-0 flex-col overflow-y-auto [overscroll-behavior:contain]" ref={bodyRef} onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}>
      {/* 내리면 위쪽 바에도 아래 단추 줄처럼 경계선을 둔다(줄이 바 밑에서 잘려 보이지 않게). */}
      <div className={`onb-top sticky top-0 z-[2] border-b bg-bg pt-[env(safe-area-inset-top)] [&_.icon-button]:m-0 [&_.icon-button]:size-[44px] ${scrolled ? 'border-line' : 'border-transparent'}`}>
        <div className="onb-top-inner mx-auto grid w-[min(100%,36rem)] grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-[12px] pt-[8px] pr-[12px] pb-[4px] pl-[4px] min-[900px]:pt-[16px]">
          {showBack
            ? <button type="button" className="icon-button grid place-items-center flex-none size-[44px] border-0 rounded-pill bg-transparent text-ink-2 active:bg-hover disabled:text-ink-3 min-[720px]:size-[36px] min-[720px]:rounded-sm [@media(hover:hover)]:[&:hover:not(:disabled)]:bg-hover" aria-label="이전 단계" onClick={back}><svg className="i size-[22px] flex-none fill-none stroke-current [stroke-width:1.75] [stroke-linecap:round] [stroke-linejoin:round]" aria-hidden="true"><use href="icons/sprite.svg#back" /></svg></button>
            : <span className="onb-top-slot block size-[44px]" aria-hidden="true" />}
          {fillMode && fill.length < 2 ? <div className="onb-progress" aria-hidden="true" /> : <div className="onb-progress flex items-center gap-[6px]" role="progressbar" aria-valuemin={1} aria-valuemax={fillMode ? fill.length : STEPS.length} aria-valuenow={index + 1}
            aria-valuetext={`${fillMode ? fill.length : STEPS.length}단계 중 ${index + 1}단계`} aria-label={fillMode ? '필요한 정보 채우기 진행' : '첫 설정 진행'}>
            {(fillMode ? fill : STEPS).map((name, i) => <span className={`h-[4px] flex-1 rounded-pill [transition:background_.2s] ${i <= index ? 'bg-ink' : 'bg-line'}`} key={name} data-done={i <= index} />)}
          </div>}
          {/* 첫 설정은 처음에만 열리고 건너뛸 수도, 닫을 수도 없다(전공과 AI 키는 필수). */}
          <span className="onb-top-slot block size-[44px]" aria-hidden="true" />
        </div>
      </div>
      <div className="onb-body mx-auto grid w-[min(100%,36rem)] flex-[1_0_auto] auto-rows-max content-start gap-[16px] px-[16px] pt-[8px] pb-[24px] min-[900px]:flex-none [&>p]:m-0 [&>p]:text-ink-2 [&_h1:focus]:outline-none [&_h1]:mt-[8px] [&_h1]:mb-0 [&_h1]:overflow-visible [&_h1]:text-clip [&_h1]:whitespace-normal min-[900px]:[&_h1]:text-[21px] min-[900px]:[&_h1]:leading-[28px]">
        <h1 id="onb-title" ref={heading} tabIndex={-1}>{title}</h1>
        {lead ? <p className="onb-lead m-0 text-ink-2">{lead}</p> : null}
        {body}
        {fillMode && app.onboardingError && step !== 'ai' && step !== 'boards' ? <p className="error-text text-[14px] text-danger" role="alert">{app.onboardingError}</p> : null}
      </div>
      {foot ? <div className="onb-foot sticky bottom-0 z-[2] border-t border-line bg-bg pt-[12px] [&_.solid-button]:w-full [&_.ghost-button]:w-full [&_.solid-button:disabled]:border-line [&_.solid-button:disabled]:bg-sunken [&_.solid-button:disabled]:text-ink-2 [&_.solid-button:disabled]:opacity-100"><div className="onb-foot-inner mx-auto grid w-[min(100%,36rem)] gap-[8px] px-[16px] pt-0 pb-[calc(12px+env(safe-area-inset-bottom))]">
        {blocked ? <>
          <p className="m-0 text-center text-[14px] text-ink-2" role="alert"><span className="font-semibold text-ink">필수 선택이 남았어요</span><br /><span>{STEP_LABEL[blocked]}에서 골라 주세요</span></p>
          <button type="button" className="solid-button [@media(hover:hover)]:hover:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] active:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] inline-flex items-center justify-center min-h-[44px] px-[16px] py-0 rounded-md border-0 bg-accent text-on-accent text-[15px] font-semibold no-underline whitespace-nowrap select-none [-webkit-user-select:none]" onClick={() => go(blocked)}>{STEP_LABEL[blocked]}(으)로 돌아가기</button>
        </> : <>
          {missingHint(step, draft, doubleAnswer) && !addingDouble ? <RequiredHint text={missingHint(step, draft, doubleAnswer)} /> : null}
          {foot}
        </>}</div></div> : null}
    </div>
  </div>;
}
