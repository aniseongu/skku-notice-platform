// 설정 화면에서 키를 GitHub 저장소 Secrets로 바로 보낸다(docs/design/ux-rules.md 2-2절).
// 키 값은 브라우저에 저장하지 않고, GitHub가 준 저장소 공개키로 봉인(libsodium sealed box)해서만 보낸다.
// GitHub 토큰은 GitHub API에만 보낸다. 설정 화면이 이 기기에 기억한다(2026-11-03 사용자 요청).

const API = 'https://api.github.com';
// 아이디/저장소. 점만으로 된 부분(., ..)은 API 경로를 바꿀 수 있어서 막는다.
export const REPO_PATTERN = /^(?!\.{1,2}\/)[\w.-]+\/(?!\.{1,2}$)[\w.-]+$/;

export class GitHubError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) { super(message); this.status = status; }
}

export class SecretWriteUncertainError extends Error {
  constructor() { super('저장 결과를 확인하지 못했어요. 연결 상태를 확인해 주세요'); }
}

function headers(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}

// allowConflict: 변수 만들기에서만 409(이미 있음)를 정상으로 보고 수정으로 넘어간다. Secret 저장의 409는 실패다.
async function call(path: string, token: string, init: RequestInit = {}, allowConflict = false): Promise<Response> {
  const response = await fetch(`${API}${path}`, { ...init, headers: { ...headers(token), ...(init.headers ?? {}) } });
  if (response.status === 401) throw new GitHubError('GitHub 토큰이 맞지 않아요. 새 토큰을 넣어 주세요', response.status);
  if (response.status === 403 || response.status === 404) throw new GitHubError('저장소 이름과 토큰 권한(Secrets, Variables)을 확인해 주세요', response.status);
  if (response.status === 409 && allowConflict) return response;
  if (!response.ok) throw new GitHubError(`GitHub가 요청을 받지 않았어요(오류 ${response.status}). 잠시 뒤 다시 해 주세요`, response.status);
  return response;
}

export async function listSecrets(repo: string, token: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (let page = 1; ; page++) {
    const response = await call(`/repos/${repo}/actions/secrets?per_page=100&page=${page}`, token, { cache: 'no-store' });
    const body = (await response.json()) as { total_count: number; secrets: { name: string; updated_at: string }[] };
    for (const secret of body.secrets) result[secret.name] = secret.updated_at;
    if (page * 100 >= body.total_count) return result;
    if (body.secrets.length === 0) throw new GitHubError('기기 목록을 모두 불러오지 못했어요. 다시 시도해 주세요');
  }
}

export async function saveSecret(repo: string, token: string, name: string, value: string): Promise<void> {
  const keyResponse = await call(`/repos/${repo}/actions/secrets/public-key`, token);
  const { key, key_id: keyId } = (await keyResponse.json()) as { key: string; key_id: string };
  // 암호화 라이브러리는 저장할 때만 불러온다(목록 화면을 가볍게).
  const sodium = (await import('libsodium-wrappers')).default;
  await sodium.ready;
  const sealed = sodium.crypto_box_seal(sodium.from_string(value), sodium.from_base64(key, sodium.base64_variants.ORIGINAL));
  try {
    await call(`/repos/${repo}/actions/secrets/${name}`, token, {
      method: 'PUT',
      body: JSON.stringify({ encrypted_value: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL), key_id: keyId }),
    });
  } catch (error) {
    if (error instanceof GitHubError && error.status && error.status < 500) throw error;
    throw new SecretWriteUncertainError();
  }
}

export async function deleteSecret(repo: string, token: string, name: string): Promise<void> {
  await call(`/repos/${repo}/actions/secrets/${name}`, token, { method: 'DELETE' });
}

// 관심 키워드는 비밀이 아니라서 Actions 변수(INTEREST_KEYWORDS)로 둔다.
export async function readVariable(repo: string, token: string, name: string): Promise<string | null> {
  try {
    const response = await call(`/repos/${repo}/actions/variables/${name}`, token);
    return ((await response.json()) as { value: string }).value;
  } catch (error) {
    // GitHub의 404는 권한 부족일 수도 있다. 변수 목록에 접근할 수 있을 때만 부재로 본다.
    if (error instanceof GitHubError && error.status === 404) {
      await call(`/repos/${repo}/actions/variables?per_page=1`, token);
      return null;
    }
    throw error;
  }
}

export async function saveVariable(repo: string, token: string, name: string, value: string): Promise<void> {
  // GitHub 변수는 빈 값을 받지 않는다(422). 비우면 변수를 지운다. 이미 없으면(404) 그대로 둔다.
  if (!value.trim()) {
    const response = await fetch(`${API}/repos/${repo}/actions/variables/${name}`, { method: 'DELETE', headers: headers(token) });
    if (response.ok) return;
    if (response.status === 404 && await readVariable(repo, token, name) === null) return;
    if (response.status === 401) throw new GitHubError('GitHub 토큰이 맞지 않아요. 새 토큰을 넣어 주세요', response.status);
    throw new GitHubError(`GitHub가 요청을 받지 않았어요(오류 ${response.status}). 잠시 뒤 다시 해 주세요`, response.status);
  }
  const created = await call(`/repos/${repo}/actions/variables`, token, { method: 'POST', body: JSON.stringify({ name, value }) }, true);
  if (created.status === 409) {
    await call(`/repos/${repo}/actions/variables/${name}`, token, { method: 'PATCH', body: JSON.stringify({ name, value }) });
  }
}

/** Create only: never replace a name saved by another device. */
export async function createVariableIfAbsent(repo: string, token: string, name: string, value: string): Promise<boolean> {
  const response = await call(`/repos/${repo}/actions/variables`, token,
    { method: 'POST', body: JSON.stringify({ name, value }) }, true);
  return response.status !== 409;
}

// Gemini 키가 맞는지 모델 목록을 하나만 불러 본다. 키는 Google로만 간다.
export async function checkGeminiKey(key: string): Promise<boolean> {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
    headers: { 'x-goog-api-key': key },
  });
  if (response.ok) return true;
  if ([400, 401, 403].includes(response.status)) return false;
  throw new Error('키를 확인하지 못했어요. 잠시 뒤 다시 확인해 주세요');
}

// 수동 실행도 서버의 수집 간격 제한을 따른다. 기본 브랜치는 저장소에서 확인한다.
export async function requestCollection(repo: string, token: string): Promise<void> {
  if (!REPO_PATTERN.test(repo)) throw new GitHubError('저장소 이름을 확인해 주세요');
  const info = await call(`/repos/${repo}`, token);
  const { default_branch: branch } = await info.json() as { default_branch: string };
  if (!branch) throw new GitHubError('저장소의 기본 브랜치를 확인하지 못했어요');
  try {
    await call(`/repos/${repo}/actions/workflows/notice-and-pages.yml/dispatches`, token, {
      method: 'POST', body: JSON.stringify({ ref: branch }),
    });
  } catch (error) {
    if (error instanceof GitHubError && (error.status === 403 || error.status === 404))
      throw new GitHubError('Actions 쓰기 권한을 확인해 주세요', error.status);
    throw error;
  }
}

// GitHub 로그인으로도 Actions 화면에서 수동 실행할 수 있다.
export function collectionWorkflowUrl(repo: string): string | null {
  return REPO_PATTERN.test(repo) ? `https://github.com/${repo}/actions/workflows/notice-and-pages.yml` : null;
}
