import { useState, type ReactNode } from 'react';
import { looksLikeAiKey, PROVIDER_GUIDE, type AiPreferences } from './ai-providers';
import type { AppController } from './app-controller';
import type { AiProvider } from './ai-providers';
import { Choice, ext, Guide, Setting, SecretRow, type SettingsModel } from './platform-settings';

type Byok = NonNullable<SettingsModel['byok']>;
type Id = 'groq' | 'gemini' | 'openrouter';
/** 처음 보는 사람에게 권하는 순서. 연결 상태가 바뀌어도 자리는 그대로 둔다. */
const ORDER: readonly Id[] = ['groq', 'gemini', 'openrouter'];
const NAME: Record<Id, string> = { groq: 'Groq', gemini: 'Gemini', openrouter: 'OpenRouter' };
const BLURB: Record<Id, string> = {
  groq: '빠르게 답해요',
  gemini: '공지 요약과 번역에 써요',
  openrouter: '여러 모델을 한 키로 써요',
};
const GUIDE: Record<Id, { url: string; placeholder: string; steps: string[] }> = {
  groq: { url: PROVIDER_GUIDE.groq.url, placeholder: '키를 붙여 넣어 주세요', steps: PROVIDER_GUIDE.groq.steps },
  openrouter: { url: PROVIDER_GUIDE.openrouter.url, placeholder: '키를 붙여 넣어 주세요', steps: PROVIDER_GUIDE.openrouter.steps },
  gemini: {
    url: 'https://aistudio.google.com/apikey', placeholder: '키를 붙여 넣어 주세요',
    steps: ['Google AI Studio 키 만들기 화면을 열고 Google 계정으로 로그인해요',
      '"API 키 만들기"를 누르고, 프로젝트를 고르라고 하면 새 프로젝트를 만들어요',
      '만들어진 키를 복사해요',
      '여기로 돌아와 키를 붙여 넣고 "연결하기"를 눌러요'],
  },
};

const LABELS = { empty: '연결 안 됨', saved: '연결됨', disabled: '', broken: '키를 확인해 주세요', retry: '바꾸기', close: '취소', add: '연결하기', edit: '바꾸기', remove: '연결 끊기', save: '연결하기' };

const lnk = (href: string, text: string) => <a key={href} href={href} target="_blank" rel="noopener noreferrer">{text}</a>;

/** 받는 방법 안내. 눌러서 펼치면 순서가 한 번에 다 보인다. 이미 연결했어도 줄 아래에 계속 둔다. */
export function StepGuide({ label, sub, steps, note }: { label: string; sub: string; steps: ReactNode[]; note: string }) {
  return <div className="setting stacked"><details className="group w-full">
    <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between text-[15px] font-semibold text-ink [&::-webkit-details-marker]:hidden"><span className="flex flex-col py-1">{label}<span className="text-[13px] font-normal text-ink-3">{sub}</span></span>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-ink-3 transition-transform group-open:rotate-180"><path d="M6 9l6 6 6-6" /></svg></summary>
    <div className="flex flex-col gap-3 pb-2 pt-1">
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {steps.map((step, index) => <li key={index} className="flex items-start gap-2 text-[13px] leading-[20px] text-ink-2">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-pill bg-sunken text-[12px] font-semibold text-ink-2">{index + 1}</span>
          <span>{step}</span></li>)}
      </ol>
      <p className="m-0 text-[13px] text-ink-3">{note}</p>
    </div>
  </details></div>;
}

function SharedGuide() {
  return <StepGuide label="키는 어디서 받나요?" sub="세 곳 모두 무료로 만들 수 있어요" note="키는 암호화해서 서버에만 보관해요"
    steps={[<>{lnk(GUIDE.groq.url, 'Groq')}, {lnk(GUIDE.gemini.url, 'Gemini')}, {lnk(GUIDE.openrouter.url, 'OpenRouter')} 중 한 곳에서 로그인해요</>,
      '"키 만들기"를 눌러요', '키를 복사해요. 한 번만 보여요', '위 칸에 붙여 넣고 "연결하기"를 눌러요']} />;
}

/** AI 연결 줄들. 다른 설정 쪽과 같은 줄(이름, 설명, 오른쪽 조작) 모양이고, 연결한 개수에 따라 필요한 줄만 보인다. */
/** only를 주면 그 업체 줄만 보인다(첫 설정은 Gemini 하나만 묻고, 나머지는 설정에서 연결한다). */
export function AiRows({ byok, alignEnd = false, only }: { byok?: Byok; alignEnd?: boolean; only?: Id }) {
  const [last, setLast] = useState<Id | null>(null);
  const ai = byok?.ai;
  if (!byok?.available || !ai) {
    return <Setting name="AI 연결" help="지금은 키를 연결할 수 없어요. 잠시 뒤 다시 열어 주세요" />;
  }
  return <>
    {ORDER.filter((id) => !only || id === only).map((id) => {
      const name = `${NAME[id]} 키`;
      if (id === 'gemini') {
        return <SecretRow key={id} name={name} help={BLURB[id]} placeholder={GUIDE[id].placeholder} status={byok.status} loading={byok.loading} busy={byok.busy}
          error={byok.error} alignEnd={alignEnd} labels={LABELS} guide={null} valid={looksLikeAiKey}
          onRegister={byok.register} onRemove={byok.remove} />;
      }
      const status = ai.keys.find((key) => key.provider === id) ?? null;
      return <SecretRow key={id} name={name} help={BLURB[id]} placeholder={GUIDE[id].placeholder} status={status} loading={byok.loading} busy={ai.busy}
        error={last === id ? ai.error : ''} alignEnd={alignEnd} labels={LABELS} guide={null} valid={looksLikeAiKey}
        onRegister={(key) => { setLast(id); ai.register(id as AiProvider, key); }} onRemove={() => { setLast(id); ai.remove(id as AiProvider); }} />;
    })}
    {only ? <StepGuide label="키는 어디서 받나요?" sub="무료로 만들 수 있어요" note="키는 암호화해서 서버에만 보관해요"
      steps={[<>{lnk(GUIDE[only].url, `${NAME[only]} 키 만들기 화면`)}을 열고 로그인해요</>, ...GUIDE[only].steps.slice(1)]} /> : <SharedGuide />}
  </>;
}

/** 설정과 첫 설정이 같은 모양으로 컨트롤러에 연결한다. */
export function aiConnectModel(app: AppController): Byok {
  return {
    available: app.byokOn, loading: app.byokLoading, busy: app.byokBusy, error: app.byokError, status: app.byokStatus, backfill: app.byokBackfill,
    register: (apiKey: string) => { void app.registerKey(apiKey); }, remove: () => { void app.removeKey(); },
    ai: { keys: app.aiKeys, prefs: app.aiPrefs, busy: app.aiBusy, error: app.aiError, gemini: !!app.byokStatus && !app.byokStatus.disabled,
      register: (provider: AiProvider, key: string, model?: string) => { void app.registerAi(provider, key, model); }, remove: (provider: AiProvider) => { void app.removeAi(provider); },
      savePrefs: (prefs: AiPreferences) => { void app.updateAiPrefs(prefs); } },
    canvas: app.canvasStatus, canvasBusy: app.canvasBusy, canvasError: app.canvasError,
    registerCanvas: (token: string) => { void app.registerCanvas(token); }, removeCanvas: () => { void app.removeCanvas(); },
  };
}
