import { useEffect, useId, useRef, useState } from 'react';
import { AlertIcon } from './alert-icon';
import type { BoardRequestResult, BoardRequestState } from './shared-board-requests';

function validAddress(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'skku.edu' || url.hostname.endsWith('.skku.edu'));
  } catch { return false; }
}

export function BoardRequest({ toast, userId, listRequests, submitRequest, onAdded }: {
  toast: (message: string) => void;
  userId: string | null;
  listRequests: (userId: string) => Promise<BoardRequestState[] | null>;
  submitRequest: (userId: string, name: string, url: string) => Promise<BoardRequestResult>;
  onAdded?: (sourceId: string) => void;
}) {
  const addressHelpId = useId();
  const addressErrorId = useId();
  const formRef = useRef<HTMLDivElement>(null);
  const ownerRef = useRef(userId);
  ownerRef.current = userId;
  const listRef = useRef(listRequests);
  listRef.current = listRequests;
  const refreshEpoch = useRef(0);
  const onAddedRef = useRef(onAdded);
  onAddedRef.current = onAdded;
  const requestStatuses = useRef(new Map<string, BoardRequestState['status']>());
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requestState, setRequestState] = useState<{ owner: string | null; rows: BoardRequestState[] }>({ owner: userId, rows: [] });
  const requests = requestState.owner === userId ? requestState.rows : [];
  const applyRows = (owner: string, rows: BoardRequestState[]) => {
    for (const row of rows) {
      if (row.status === 'added' && row.source_id && requestStatuses.current.get(row.id) === 'pending') {
        onAddedRef.current?.(row.source_id);
      }
      requestStatuses.current.set(row.id, row.status);
    }
    setRequestState({ owner, rows });
  };
  useEffect(() => {
    let active = true;
    ownerRef.current = userId;
    setRequestState({ owner: userId, rows: [] }); setName(''); setAddress(''); setError(''); setOpen(false); setBusy(false);
    requestStatuses.current.clear();
    refreshEpoch.current += 1;
    if (!userId) return () => { active = false; ownerRef.current = null; };
    const refresh = async () => {
      const epoch = ++refreshEpoch.current;
      try {
        const rows = await listRef.current(userId);
        if (active && ownerRef.current === userId && epoch === refreshEpoch.current && rows) applyRows(userId, rows);
      } catch { /* 이전 계정의 상태를 보여 주지 않는다. */ }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 30_000);
    return () => { active = false; ownerRef.current = null; window.clearInterval(timer); };
  }, [userId]);
  useEffect(() => {
    if (open) formRef.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);
  const invalid = !validAddress(address.trim());
  const submit = async () => {
    if (busy || !name.trim() || invalid) return;
    const owner = userId;
    if (!owner) return;
    setBusy(true); setError('');
    try {
      const result = await submitRequest(owner, name.trim(), address.trim());
      if (ownerRef.current !== owner) return;
      if (result.status === 'ok') {
        requestStatuses.current.set(result.id, 'pending');
        setName(''); setAddress(''); setOpen(false);
        toast('요청을 접수했어요');
        const epoch = ++refreshEpoch.current;
        try {
          const rows = await listRequests(owner);
          if (ownerRef.current === owner && epoch === refreshEpoch.current && rows) applyRows(owner, rows);
        } catch { /* 상태 조회는 다음 자동 조회에서 다시 시도한다. */ }
      } else setError(result.status === 'limit' ? '오늘은 5번까지 보낼 수 있어요. 내일 다시 보내 주세요' : '보내지 못했어요. 잠시 뒤 다시 시도해 주세요');
    } catch { setError('보내지 못했어요. 잠시 뒤 다시 시도해 주세요'); }
    finally { if (ownerRef.current === owner) setBusy(false); }
  };
  const input = 'min-h-[44px] w-full rounded-md border border-line bg-surface px-[12px] text-[15px] text-ink';
  return <div className="border-t border-line">
    <div className="flex min-h-[52px] items-center justify-between gap-[8px]">
      <span className="text-[15px] font-normal text-ink-2">찾는 게시판이 없나요?</span>
      <button type="button" aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)} className="min-h-[44px] shrink-0 rounded-sm border-0 bg-transparent px-[8px] text-[15px] font-medium text-accent [@media(hover:hover)]:hover:bg-hover active:bg-hover">{open ? '접기' : '추가 요청'}</button>
    </div>
    {requests.length ? <div className="grid gap-[6px] pb-[12px] text-[14px] leading-[20px] text-ink-2" aria-live="polite">
      <p className="m-0 font-semibold text-ink">요청한 게시판</p>
      {requests.map((request) => <p key={request.id} className="m-0"><span className="font-medium text-ink">{request.name}</span><br />{request.status === 'added' ? '게시판이 추가됐어요. 받을 게시판에서 확인해 주세요' : request.status === 'review' ? '개발자 확인을 요청했어요' : request.status === 'failed' ? '요청을 보내지 못했어요. 나중에 다시 시도해 주세요' : '요청을 확인하고 있어요'}</p>)}
    </div> : null}
    {open ? <div ref={formRef} className="grid w-full max-w-[600px] gap-[10px] pb-[16px]">
      <p className="m-0 text-[14px] leading-[20px] text-ink-2">추가된 게시판은 다른 사람도 고를 수 있어요</p>
      <label className="grid gap-[4px] text-[14px] font-semibold">게시판 이름 (필수)<input className={input} value={name} maxLength={60} required disabled={busy} onChange={(e) => setName(e.currentTarget.value)} /></label>
      <div className="grid gap-[4px]">
        <label className="grid gap-[4px] text-[14px] font-semibold">주소 (선택)<input className={input} type="url" value={address} maxLength={400} disabled={busy} aria-invalid={invalid} aria-describedby={invalid ? `${addressHelpId} ${addressErrorId}` : addressHelpId} onChange={(e) => setAddress(e.currentTarget.value)} /></label>
        <p id={addressHelpId} className="m-0 text-[14px] leading-[20px] text-ink-2">https로 시작하는 성균관대 주소를 적으면 자동으로 확인해요. 주소가 없으면 개발자에게 요청해요</p>
        {invalid ? <p id={addressErrorId} className="m-0 text-[14px] leading-[20px] text-danger" role="alert">https로 시작하는 성균관대 주소인지 확인해 주세요</p> : null}
      </div>
      {error ? <p className="m-0 text-[14px] text-danger" role="alert"><AlertIcon />{error}</p> : null}
      <button type="button" disabled={busy || !name.trim() || invalid} onClick={() => { void submit(); }} className="solid-button [@media(hover:hover)]:hover:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] active:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] inline-flex min-h-[44px] items-center justify-center rounded-md border-0 bg-accent px-[16px] text-[15px] font-semibold text-on-accent disabled:border disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60">{busy ? '보내고 있어요' : '요청 보내기'}</button>
    </div> : null}
  </div>;
}
