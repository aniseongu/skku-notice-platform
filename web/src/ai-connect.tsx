import { useEffect, useState, type ReactNode } from 'react';
import { aiModeLabel, looksLikeAiKey, PROVIDER_GUIDE, type AiPreferences } from './ai-providers';
import { backfillNote } from './byok';
import type { AppController } from './app-controller';
import type { AiProvider } from './ai-providers';
import type { SettingsModel } from './platform-settings';

type Byok = NonNullable<SettingsModel['byok']>;
type Id = 'groq' | 'gemini' | 'openrouter';
/** 처음 보는 사람에게 권하는 순서. 연결 상태가 바뀌어도 자리는 그대로 둔다. */
const ORDER: readonly Id[] = ['groq', 'gemini', 'openrouter'];
const NAME: Record<Id, string> = { groq: 'Groq', gemini: 'Gemini', openrouter: 'OpenRouter' };
const BLURB: Record<Id, string> = {
  groq: '빠르게 답해요',
  gemini: '요약, 번역, 인턴 판정에 써요',
  openrouter: '한 키로 여러 모델을 써요',
};
const GUIDE: Record<Id, { url: string; placeholder: string; steps: string[] }> = {
  groq: { url: PROVIDER_GUIDE.groq.url, placeholder: PROVIDER_GUIDE.groq.placeholder, steps: PROVIDER_GUIDE.groq.steps },
  openrouter: { url: PROVIDER_GUIDE.openrouter.url, placeholder: PROVIDER_GUIDE.openrouter.placeholder, steps: PROVIDER_GUIDE.openrouter.steps },
  gemini: {
    url: 'https://aistudio.google.com/apikey', placeholder: 'Google AI Studio에서 만든 키',
    steps: ['Google AI Studio의 API 키 화면을 열고 Google 계정으로 로그인해요', '"API 키 만들기"를 누르고, 프로젝트를 고르라고 하면 새 프로젝트를 만들어요',
      '만들어진 키를 붙여 넣고 "연결하기"를 눌러요. Gemini에 확인한 뒤 암호화해 서버에만 보관해요',
      '무료 등급은 보낸 내용이 Google 제품 개선에 쓰일 수 있어요'],
  },
};

interface Card { id: Id; status: { keyHint: string; disabled: boolean; lastError: string | null } | null; busy: boolean; error: string; note: string | null;
  register: (key: string) => void; remove: () => void }

function cards(byok: Byok): Card[] {
  const ai = byok.ai;
  return ORDER.map((id): Card => {
    if (id === 'gemini') {
      return { id, status: byok.status, busy: byok.busy, error: byok.error, note: backfillNote(byok.backfill, !!byok.status?.disabled), register: byok.register, remove: byok.remove };
    }
    const status = ai?.keys.find((key) => key.provider === id) ?? null;
    return { id, status, busy: !!ai?.busy, error: ai?.error ?? '', note: null, register: (key) => ai?.register(id, key), remove: () => ai?.remove(id) };
  });
}

const chip = 'inline-flex min-h-[28px] items-center rounded-pill px-[10px] text-[13px]';

function ProviderCard({ card, open, onOpen, onClose, loading }: { card: Card; open: boolean; onOpen: () => void; onClose: () => void; loading: boolean }) {
  const [value, setValue] = useState('');
  const [shown, setShown] = useState(false);
  const { id, status, busy, error } = card;
  const name = NAME[id];
  const guide = GUIDE[id];
  // 연결이 끝나 상태가 바뀌면 입력칸을 닫고 비운다. 키는 이 입력칸 밖에 남기지 않는다.
  useEffect(() => { if (status) { setValue(''); setShown(false); onClose(); } }, [status?.keyHint]);
  const broken = !!status?.disabled;
  const state = loading ? '확인 중' : !status ? '연결 안 됨' : broken ? '다시 연결해 주세요' : `연결됨 ····${status.keyHint}`;
  const tone = broken ? 'bg-sunken text-danger' : status ? 'bg-sunken text-accent' : 'bg-sunken text-ink-3';
  return <li data-provider={id} className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0"><p className="m-0 text-[16px] font-semibold text-ink">{name} 키</p><p className="m-0 mt-[2px] text-[14px] text-ink-2">{BLURB[id]}</p></div>
      <span className={`${chip} ${tone} shrink-0`}>{state}</span>
    </div>
    {open ? <div className="flex flex-col gap-4">
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        <li className="flex flex-col gap-2"><p className="m-0 text-[14px] font-semibold text-ink">1. 키를 만들어요</p>
          <a className="ghost-button inline-flex min-h-[44px] items-center justify-center no-underline" href={guide.url} target="_blank" rel="noopener noreferrer">{name}에서 키 만들기</a>
          <details className="text-[14px] text-ink-2"><summary className="min-h-[32px] cursor-pointer">만드는 방법</summary>
            <ol className="mt-2 list-decimal pl-5">{guide.steps.map((step, index) => <li key={index} className="mb-1">{step}</li>)}</ol></details></li>
        <li className="flex flex-col gap-2"><p className="m-0 text-[14px] font-semibold text-ink">2. 키를 붙여 넣어요</p>
          <div className="flex gap-2">
            <input className="input min-w-0 flex-1" type={shown ? 'text' : 'password'} autoComplete="off" spellCheck={false} aria-label={`${name} 키`}
              placeholder={guide.placeholder} value={value} disabled={busy} onChange={(event) => setValue(event.currentTarget.value.trim())} />
            <button type="button" className="ghost-button min-h-[44px] shrink-0" aria-pressed={shown} disabled={busy} onClick={() => setShown(!shown)}>{shown ? '숨기기' : '보기'}</button>
          </div></li>
        <li className="flex flex-col gap-2"><p className="m-0 text-[14px] font-semibold text-ink">3. 연결해요</p>
          <button type="button" className="solid-button min-h-[48px]" disabled={busy || !value || !looksLikeAiKey(value)} onClick={() => card.register(value)}>{busy ? '확인하고 있어요' : '연결하기'}</button>
          <p className="m-0 text-[13px] text-ink-3">연결하기 전에 {name}에 확인하고, 암호화해서 서버에만 보관해요</p></li>
      </ol>
      {error ? <p className="m-0 text-[14px] text-danger" role="alert">{error}</p> : null}
      <button type="button" className="ghost-button min-h-[44px]" disabled={busy} onClick={() => { onClose(); setValue(''); setShown(false); }}>닫기</button>
    </div> : <>
      {status?.lastError ? <p className="m-0 text-[14px] text-danger" role="alert">{status.lastError}</p> : null}
      {card.note ? <p className="m-0 text-[14px] text-ink-2" role="status">{card.note}</p> : null}
      {error ? <p className="m-0 text-[14px] text-danger" role="alert">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" className="ghost-button min-h-[44px] flex-1" aria-label={`${name} 키 ${status ? '바꾸기' : '연결하기'}`} disabled={loading} onClick={onOpen}>{status ? (broken ? '다시 연결하기' : '바꾸기') : '연결하기'}</button>
        {status ? <button type="button" className="ghost-button min-h-[44px] text-danger" aria-label={`${name} 키 연결 끊기`} disabled={busy} onClick={card.remove}>연결 끊기</button> : null}
      </div>
    </>}
  </li>;
}

function Options<T extends string>({ label, value, options, onPick, disabled }: {
  label: string; value: T; options: readonly { value: T; title: string; help: string }[]; onPick: (value: T) => void; disabled?: boolean;
}) {
  return <div role="radiogroup" aria-label={label} className="flex flex-col gap-2">
    {options.map((option) => {
      const on = option.value === value;
      return <button key={option.value} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onPick(option.value)}
        className={`flex min-h-[56px] flex-col items-start gap-[2px] rounded-md border p-3 text-left ${on ? 'border-accent bg-sunken' : 'border-line bg-surface'}`}>
        <span className="text-[15px] font-semibold text-ink">{option.title}</span><span className="text-[13px] text-ink-2">{option.help}</span>
      </button>;
    })}
  </div>;
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return <div className="flex flex-col gap-3"><h4 className="m-0 text-[15px] font-semibold text-ink">{title}</h4>{children}</div>;
}

/** AI 연결. 하나도 연결하지 않아도, 하나만 연결해도, 여러 곳을 연결해도 각자 필요한 만큼만 보인다. */
export function AiConnect({ byok }: { byok: Byok }) {
  const [openId, setOpenId] = useState<Id | null>(null);
  const ai = byok.ai;
  const list = cards(byok);
  const usable = list.filter((card) => card.status && !card.status.disabled);
  const count = usable.length;
  const prefs: AiPreferences | undefined = ai?.prefs;
  if (!byok.available || !ai || !prefs) {
    return <p className="m-0 text-[14px] text-ink-2">지금은 키를 연결할 수 없어요. 잠시 뒤 다시 열어 주세요</p>;
  }
  const off = !prefs.aiEnabled && count > 0;
  const title = off ? 'AI 분석이 꺼져 있어요' : count === 0 ? '연결하지 않아도 괜찮아요' : count === 1 ? `${NAME[usable[0].id]}를 연결했어요` : `${count}곳을 연결했어요`;
  const lead = off ? '기본 방식으로만 분석해요'
    : count === 0 ? '공지 분류와 알림, 졸업요건 확인은 기본 방식으로 계속 해요. 연결하면 요약과 맞춤 판정을 더 자세히 받아요'
      : count === 1 ? '이 키로 요약과 판정을 만들어요. 한도가 차면 기본 방식으로 이어서 분석해요'
        : '아래에서 여러 곳을 어떻게 쓸지 골라요';
  const usableIds = usable.map((card) => card.id);
  const chosen = prefs.manualProvider && usableIds.includes(prefs.manualProvider) ? prefs.manualProvider : usableIds[0];
  const routing = prefs.routingMode;
  return <div className="flex flex-col gap-5">
    <div className="rounded-md bg-sunken p-4" role="status" aria-label="AI 연결 상태">
      <p className="m-0 text-[17px] font-semibold text-ink">{title}</p>
      <p className="m-0 mt-1 max-w-none text-[14px] text-ink-2">{lead}</p>
      <p className="m-0 mt-2 text-[13px] text-ink-3">{aiModeLabel(count, prefs)}</p>
    </div>
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {list.map((card) => <ProviderCard key={card.id} card={card} loading={byok.loading} open={openId === card.id} onOpen={() => setOpenId(card.id)} onClose={() => setOpenId((current) => (current === card.id ? null : current))} />)}
    </ul>
    {count >= 2 && prefs.aiEnabled ? <Block title="여러 곳은 어떻게 쓸까요?">
      <Options label="여러 곳 사용 방식" value={routing} disabled={ai.busy} onPick={(value) => ai.savePrefs({ ...prefs, routingMode: value, autoRoutingConsent: value === 'auto', manualProvider: value === 'auto' ? null : chosen ?? null })}
        options={[
          { value: 'manual', title: '직접 고르기', help: '고른 한 곳만 써요. 막혀도 다른 곳으로 보내지 않아요' },
          { value: 'auto', title: '자동으로 고르기', help: '쓸 수 있는 곳을 알아서 골라요. 공지 글이 연결한 곳 어디로든 보내질 수 있어요' },
        ] as const} />
      {routing === 'manual' ? <Options label="사용할 곳" value={chosen ?? 'gemini'} disabled={ai.busy} onPick={(value) => ai.savePrefs({ ...prefs, manualProvider: value })}
        options={usableIds.map((id) => ({ value: id, title: NAME[id], help: BLURB[id] }))} /> : null}
    </Block> : null}
    {count >= 1 ? <details className="rounded-md border border-line bg-surface p-4">
      <summary className="min-h-[32px] cursor-pointer text-[15px] font-semibold text-ink">요금과 사용 설정</summary>
      <div className="mt-3 flex flex-col gap-5">
        <Block title="요금">
          <Options label="요금" value={prefs.paidOptIn ? 'paid' : 'free'} disabled={ai.busy || !prefs.aiEnabled} onPick={(value) => ai.savePrefs({ ...prefs, paidOptIn: value === 'paid' })}
            options={[
              { value: 'free', title: '무료 모델만 쓰기', help: '기본이에요. 요금이 나올 수 있는 모델은 쓰지 않아요' },
              { value: 'paid', title: '유료 모델도 쓰기', help: '내 계정에 요금이 나올 수 있어요. 한도는 각 서비스에서 정해요' },
            ] as const} />
        </Block>
        <Block title="AI 분석">
          <Options label="AI 분석" value={prefs.aiEnabled ? 'on' : 'off'} disabled={ai.busy} onPick={(value) => ai.savePrefs({ ...prefs, aiEnabled: value === 'on' })}
            options={[
              { value: 'on', title: '켜기', help: '연결한 키로 요약과 판정을 만들어요' },
              { value: 'off', title: '끄기', help: '키는 그대로 두고 기본 방식으로만 분석해요' },
            ] as const} />
        </Block>
      </div>
    </details> : null}
    {ai.error && openId === null && count === 0 ? <p className="m-0 text-[14px] text-danger" role="alert">{ai.error}</p> : null}
  </div>;
}

/** 설정과 첫 설정이 같은 모양으로 컨트롤러에 연결한다. */
export function aiConnectModel(app: AppController): Byok {
  return {
    available: app.byokOn, loading: app.byokLoading, busy: app.byokBusy, error: app.byokError, status: app.byokStatus, backfill: app.byokBackfill,
    register: (apiKey: string) => { void app.registerKey(apiKey); }, remove: () => { void app.removeKey(); },
    ai: { keys: app.aiKeys, prefs: app.aiPrefs, busy: app.aiBusy, error: app.aiError, gemini: !!app.byokStatus && !app.byokStatus.disabled,
      register: (provider: AiProvider, key: string) => { void app.registerAi(provider, key); }, remove: (provider: AiProvider) => { void app.removeAi(provider); },
      savePrefs: (prefs: AiPreferences) => { void app.updateAiPrefs(prefs); } },
    canvas: app.canvasStatus, canvasBusy: app.canvasBusy, canvasError: app.canvasError,
    registerCanvas: (token: string) => { void app.registerCanvas(token); }, removeCanvas: () => { void app.removeCanvas(); },
  };
}
