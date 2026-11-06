// 출처: https://github.com/temporalio/documentation/blob/main/docs/best-practices/error-handling.mdx
import { connectionChain } from './connection-chain';
import { checkGeminiKey, listSecrets, saveSecret } from './github';

export class KeyConnectionError extends Error {}

/** 완료한 단계는 현재 탭에서만 기억한다. 토큰은 영구 저장하지 않는다. */
export function keyConnection(repo: string, token: string, name: 'CANVAS_TOKEN' | 'GEMINI_API_KEY', value: string) {
  const steps: Array<() => Promise<void>> = [async () => { await listSecrets(repo, token); }];
  if (name === 'GEMINI_API_KEY') steps.push(async () => {
    if (!await checkGeminiKey(value)) throw new KeyConnectionError('Gemini 키를 확인하지 못했어요. 키와 사용 권한을 확인해 주세요');
  });
  steps.push(async () => { await saveSecret(repo, token, name, value); });
  return connectionChain(steps);
}
