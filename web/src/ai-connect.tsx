import { useState } from 'react';
import { looksLikeAiKey, PROVIDER_GUIDE, type AiPreferences } from './ai-providers';
import { backfillNote } from './byok';
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
    steps: ['Google AI Studio의 API 키 화면을 열고 Google 계정으로 로그인해요', '"API 키 만들기"를 누르고, 프로젝트를 고르라고 하면 새 프로젝트를 만들어요',
      '만들어진 키를 붙여 넣고 "연결하기"를 눌러요. Gemini에 확인한 뒤 암호화해 서버에만 보관해요',
      '무료 등급은 보낸 내용이 Google 제품 개선에 쓰일 수 있어요'],
  },
};

const LABELS = { empty: '연결 안 됨', saved: '연결됨', disabled: '', broken: '키가 거절됐어요', retry: '다시 연결', close: '취소', add: '연결하기', edit: '바꾸기', remove: '연결 끊기', save: '연결하기' };

function guideOf(id: Id) {
  const g = GUIDE[id];
  return <Guide label="키는 어디서 받나요?" steps={[ext(g.url, g.steps[0]), ...g.steps.slice(1)]} />;
}

/** AI 연결 줄들. 다른 설정 쪽과 같은 줄(이름, 설명, 오른쪽 조작) 모양이고, 연결한 개수에 따라 필요한 줄만 보인다. */
export function AiRows({ byok }: { byok?: Byok }) {
  const [last, setLast] = useState<Id | null>(null);
  const ai = byok?.ai;
  if (!byok?.available || !ai) {
    return <Setting name="AI 연결" help="지금은 키를 연결할 수 없어요. 잠시 뒤 다시 열어 주세요" />;
  }
  const { prefs } = ai;
  const usable = ORDER.filter((id) => (id === 'gemini' ? !!byok.status && !byok.status.disabled : ai.keys.some((key) => key.provider === id && !key.disabled)));
  const count = usable.length;
  const lead = count === 0 ? '안 넣어도 괜찮아요. 한 곳만 연결해도 공지 요약과 분석이 더 자세해져요'
    : !prefs.aiEnabled ? '키는 그대로 두고 기본 방식으로만 분석해요'
      : count === 1 ? '연결한 키로 요약과 판정을 만들어요. 한도가 차면 기본 방식으로 이어서 분석해요'
        : '연결한 곳 중 쓸 수 있는 곳을 알아서 골라 써요. 공지 글은 연결한 곳으로 보내져요';
  return <>
    <Setting name="AI 분석" help={lead}>
      {count > 0 ? <Choice label="AI 분석" value={prefs.aiEnabled ? 'on' : 'off'} disabled={ai.busy}
        options={[['on', '켜기'], ['off', '끄기']] as const} onPick={(value) => ai.savePrefs({ ...prefs, aiEnabled: value === 'on' })} /> : null}
    </Setting>
    {ORDER.map((id) => {
      const name = `${NAME[id]} 키`;
      if (id === 'gemini') {
        return <SecretRow key={id} name={name} help={BLURB[id]} placeholder={GUIDE[id].placeholder} status={byok.status} loading={byok.loading} busy={byok.busy}
          error={byok.error} labels={LABELS} guide={guideOf(id)} guideFirst valid={looksLikeAiKey} note={backfillNote(byok.backfill, !!byok.status?.disabled)}
          onRegister={byok.register} onRemove={byok.remove} />;
      }
      const status = ai.keys.find((key) => key.provider === id) ?? null;
      return <SecretRow key={id} name={name} help={BLURB[id]} placeholder={GUIDE[id].placeholder} status={status} loading={byok.loading} busy={ai.busy}
        error={last === id ? ai.error : ''} labels={LABELS} guide={guideOf(id)} guideFirst valid={looksLikeAiKey}
        onRegister={(key) => { setLast(id); ai.register(id as AiProvider, key); }} onRemove={() => { setLast(id); ai.remove(id as AiProvider); }} />;
    })}
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
