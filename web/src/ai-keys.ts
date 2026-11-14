// 연결한 AI 키 개수와 그에 따른 안내. 화면과 단위 시험이 같이 쓰는 순수 함수다.
interface KeyInfo { disabled: boolean }
interface ByokInfo { status: KeyInfo | null; ai?: { keys: KeyInfo[] } }

/** 연결한 AI 키 개수. Gemini 키는 따로 저장되어 있어 합치고, 끊긴 키는 세지 않는다. */
export function connectedAiKeys(model: { byok?: ByokInfo | null }): number {
  const byok = model.byok;
  return (byok?.status && !byok.status.disabled ? 1 : 0) + (byok?.ai?.keys.filter((key) => !key.disabled).length ?? 0);
}

/** 0·1·2개일 때 AI가 어떻게 일하는지. 한도는 업체마다 달라서, 여러 개를 연결하면 번갈아 쓰고 한 곳이 막히면 다른 곳으로 넘어간다. */
export function aiKeysLead(count: number): string {
  if (count <= 0) return '하나 이상 연결하면 AI가 공지를 확인해 드려요';
  if (count === 1) return 'AI 키는 하나 이상 있어야 해요. 다른 곳도 연결하면 번갈아 써서 더 많이 확인해요';
  return '연결한 키를 번갈아 쓰고, 한 곳이 막히면 다른 곳으로 넘어가요';
}

/** 이 키 하나를 지워도 쓸 수 있는 키가 남는지. 쓸 수 없는 키(끊긴 키)는 지워도 개수가 줄지 않으니 늘 지울 수 있고, 마지막으로 쓸 수 있는 키는 지울 수 없다. */
export function canRemoveKey(key: KeyInfo, usableCount: number): boolean {
  return key.disabled || usableCount > 1;
}
