import { useState } from 'react';
import { AlertIcon } from './alert-icon';
import type { FeedbackKind, FeedbackResult } from './feedback';

function validAddress(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'skku.edu' || url.hostname.endsWith('.skku.edu'));
  } catch { return false; }
}

export function BoardRequest({ send, toast }: { send: (kind: FeedbackKind, body: string, email: string) => Promise<FeedbackResult>; toast: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const invalid = !validAddress(address.trim());
  const submit = async () => {
    if (busy || !name.trim() || invalid) return;
    setBusy(true); setError('');
    try {
      const result = await send('idea', `[게시판 추가 요청] 이름: ${name.trim()} / 주소: ${address.trim()}`, '');
      if (result === 'ok') {
        setName(''); setAddress(''); setOpen(false);
        toast('요청을 보냈어요. 확인한 뒤 모두가 고를 수 있게 추가할게요');
      } else setError(result === 'limit' ? '오늘은 5번까지 보낼 수 있어요. 내일 다시 보내 주세요' : '보내지 못했어요. 잠시 뒤 다시 시도해 주세요');
    } catch { setError('보내지 못했어요. 잠시 뒤 다시 시도해 주세요'); }
    finally { setBusy(false); }
  };
  const input = 'min-h-[44px] w-full rounded-md border border-line bg-surface px-[12px] text-[15px] text-ink';
  return <div className="border-t border-line">
    <div className="flex min-h-[52px] items-center justify-between gap-[8px] text-[15px] text-ink">
      <span>원하는 게시판이 없나요?</span>
      <button type="button" aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)} className="min-h-[44px] shrink-0 rounded-sm border-0 bg-transparent px-[8px] text-[14px] font-semibold text-accent [@media(hover:hover)]:hover:bg-hover active:bg-hover">{open ? '접기' : '추가 요청하기'}</button>
    </div>
    {open ? <div className="grid gap-[10px] pb-[16px]">
      <label className="grid gap-[4px] text-[14px] font-semibold">게시판 이름<input className={input} value={name} maxLength={60} required disabled={busy} onChange={(e) => setName(e.currentTarget.value)} /></label>
      <label className="grid gap-[4px] text-[14px] font-semibold">주소 (선택)<input className={input} type="url" value={address} maxLength={400} disabled={busy} aria-invalid={invalid} onChange={(e) => setAddress(e.currentTarget.value)} /></label>
      {invalid ? <p className="m-0 text-[14px] text-danger" role="alert">성균관대 사이트 주소만 받을 수 있어요</p> : null}
      {error ? <p className="m-0 text-[14px] text-danger" role="alert"><AlertIcon />{error}</p> : null}
      <button type="button" disabled={busy || !name.trim() || invalid} onClick={() => { void submit(); }} className="min-h-[44px] rounded-md border-0 bg-accent px-[16px] text-[15px] font-semibold text-on-accent disabled:opacity-60">{busy ? '보내고 있어요' : '요청 보내기'}</button>
    </div> : null}
  </div>;
}
