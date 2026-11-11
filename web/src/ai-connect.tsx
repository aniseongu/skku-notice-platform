import { useState } from 'react';
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

const LABELS = { empty: '연결 안 됨', saved: '연결됨', disabled: '', broken: '키가 거절됐어요', retry: '바꾸기', close: '취소', add: '연결하기', edit: '바꾸기', remove: '연결 끊기', save: '연결하기' };

const STEPS = [
  '위에서 쓸 곳을 하나 골라 로그인해요. 처음이면 가입부터 해요',
  '"키 만들기"를 누르고 이름을 아무거나 적어요 (예: 성공). Gemini는 "API 키 만들기"예요',
  '만들어진 키를 복사해요. 키는 한 번만 보여요',
  '위 입력칸에 붙여 넣고 "연결하기"를 눌러요',
];

/** 받는 방법 안내. 눌러서 펼치면 링크와 순서가 한 번에 다 보인다. 이미 연결했어도 줄 아래에 계속 둔다. */
export function StepGuide({ label, links, steps, note }: { label: string; links: { href: string; text: string }[]; steps: string[]; note: string }) {
  return <div className="setting"><details className="group w-full">
    <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between text-[15px] font-semibold text-ink [&::-webkit-details-marker]:hidden">{label}
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-ink-3 transition-transform group-open:rotate-180"><path d="M6 9l6 6 6-6" /></svg></summary>
    <div className="flex flex-col gap-4 pb-2 pt-2">
      <div className="flex flex-wrap gap-2">
        {links.map((link) => <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer"
          className="ghost-button inline-flex min-h-[44px] items-center justify-center px-4 no-underline">{link.text}</a>)}
      </div>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {steps.map((step, index) => <li key={index} className="flex items-start gap-3 text-[14px] text-ink-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-pill bg-sunken text-[13px] font-semibold text-ink-2">{index + 1}</span>
          <span className="pt-[1px]">{step}</span></li>)}
      </ol>
      <p className="m-0 text-[13px] text-ink-3">{note}</p>
    </div>
  </details></div>;
}

function SharedGuide() {
  return <StepGuide label="키는 어디서 받나요?" links={ORDER.map((id) => ({ href: GUIDE[id].url, text: `${NAME[id]} 키 만들기` }))} steps={STEPS}
    note="키는 연결하기 전에 한 번 확인하고, 암호화해서 서버에만 보관해요" />;
}

/** AI 연결 줄들. 다른 설정 쪽과 같은 줄(이름, 설명, 오른쪽 조작) 모양이고, 연결한 개수에 따라 필요한 줄만 보인다. */
export function AiRows({ byok }: { byok?: Byok }) {
  const [last, setLast] = useState<Id | null>(null);
  const ai = byok?.ai;
  if (!byok?.available || !ai) {
    return <Setting name="AI 연결" help="지금은 키를 연결할 수 없어요. 잠시 뒤 다시 열어 주세요" />;
  }
  const usable = ORDER.filter((id) => (id === 'gemini' ? !!byok.status && !byok.status.disabled : ai.keys.some((key) => key.provider === id && !key.disabled)));
  const count = usable.length;
  const lead = count === 0 ? '안 넣어도 괜찮아요. 한 곳만 연결해도 공지 요약과 분석이 더 자세해져요'
    : count === 1 ? '연결한 키로 요약과 판정을 만들어요. 한도가 차면 기본 방식으로 이어서 분석해요'
        : '연결한 곳 중 쓸 수 있는 곳을 알아서 골라 써요. 공지 글은 연결한 곳으로 보내져요';
  return <>
    <Setting name="AI 분석" help={lead} />
    {ORDER.map((id) => {
      const name = `${NAME[id]} 키`;
      if (id === 'gemini') {
        return <SecretRow key={id} name={name} help={BLURB[id]} placeholder={GUIDE[id].placeholder} status={byok.status} loading={byok.loading} busy={byok.busy}
          error={byok.error} labels={LABELS} guide={null} valid={looksLikeAiKey}
          onRegister={byok.register} onRemove={byok.remove} />;
      }
      const status = ai.keys.find((key) => key.provider === id) ?? null;
      return <SecretRow key={id} name={name} help={BLURB[id]} placeholder={GUIDE[id].placeholder} status={status} loading={byok.loading} busy={ai.busy}
        error={last === id ? ai.error : ''} labels={LABELS} guide={null} valid={looksLikeAiKey}
        onRegister={(key) => { setLast(id); ai.register(id as AiProvider, key); }} onRemove={() => { setLast(id); ai.remove(id as AiProvider); }} />;
    })}
    <SharedGuide />
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
