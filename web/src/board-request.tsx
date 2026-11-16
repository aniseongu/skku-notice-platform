import { useEffect, useId, useRef, useState } from 'react';
import { AlertIcon } from './alert-icon';
import { SETTINGS_ACTION, SETTINGS_INPUT } from './cls';
import type { BoardRequestResult, BoardRequestState } from './shared-board-requests';

export const BOARD_TRAILING_ROW = 'flex min-h-[52px] items-center justify-between gap-[8px] px-0';

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
      const hasAddress = !!address.trim();
      const result = await submitRequest(owner, name.trim(), address.trim());
      if (ownerRef.current !== owner) return;
      if (result.status === 'ok') {
        requestStatuses.current.set(result.id, 'pending');
        setName(''); setAddress(''); setOpen(false);
        toast(hasAddress ? '요청을 받았어요. 확인되면 받을 게시판에 추가할게요' : '요청을 개발자에게 보냈어요');
        const epoch = ++refreshEpoch.current;
        try {
          const rows = await listRequests(owner);
          if (ownerRef.current === owner && epoch === refreshEpoch.current && rows) applyRows(owner, rows);
        } catch { /* 상태 조회는 다음 자동 조회에서 다시 시도한다. */ }
      } else setError(result.status === 'limit' ? '오늘은 5번까지 보낼 수 있어요. 내일 다시 보내 주세요' : '보내지 못했어요. 잠시 뒤 다시 시도해 주세요');
    } catch { setError('보내지 못했어요. 잠시 뒤 다시 시도해 주세요'); }
    finally { if (ownerRef.current === owner) setBusy(false); }
  };
  return <div className="border-t border-line">
    <div className={BOARD_TRAILING_ROW}>
      <span className="text-[15px] font-medium text-ink-2">찾는 게시판이 없나요?</span>
      <button type="button" aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)} className={`${SETTINGS_ACTION} shrink-0`}>{open ? '접기' : '추가 요청'}</button>
    </div>
    {open ? <div ref={formRef} className="grid w-full gap-[10px] pb-[16px]">
      <label className="grid gap-[4px]"><span className="text-[15px] leading-[22px] font-medium text-ink">게시판 이름</span><input className={`${SETTINGS_INPUT} w-full font-normal`} value={name} maxLength={60} required disabled={busy} onChange={(e) => setName(e.currentTarget.value)} /></label>
      <div className="grid gap-[4px]">
        <label className="grid gap-[4px]"><span className="text-[15px] leading-[22px] font-medium text-ink">주소 (선택)</span><input className={`${SETTINGS_INPUT} w-full font-normal`} type="url" value={address} maxLength={400} disabled={busy} aria-invalid={invalid} aria-describedby={invalid ? addressErrorId : addressHelpId} onChange={(e) => setAddress(e.currentTarget.value)} /></label>
        {invalid ? <p id={addressErrorId} className="m-0 text-[14px] leading-[20px] text-danger" role="alert">https로 시작하는 성균관대 주소인지 확인해 주세요</p> : <p id={addressHelpId} className="m-0 text-[14px] leading-[20px] text-ink-2">주소를 적으면 보통 30분 안에 확인해서 모두가 고를 수 있게 추가해요. 주소가 없거나 확인이 안 되면 개발자가 살펴봐요</p>}
      </div>
      {error ? <p className="m-0 text-[14px] text-danger" role="alert"><AlertIcon />{error}</p> : null}
      {!name.trim() ? <p className="m-0 text-center text-[14px] text-ink-2" role="status">게시판 이름을 적어 주세요</p> : null}
      <button type="button" disabled={busy || !name.trim() || invalid} onClick={() => { void submit(); }} className="solid-button [@media(hover:hover)]:hover:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] active:bg-[color-mix(in_oklch,var(--accent)_88%,var(--text))] inline-flex min-h-[44px] w-full items-center justify-center rounded-md border-0 bg-accent px-[16px] text-[15px] font-semibold text-on-accent disabled:border disabled:border-line disabled:bg-transparent disabled:text-ink-3 disabled:opacity-60">{busy ? '보내고 있어요' : '요청 보내기'}</button>
    </div> : null}
    {(open || requests.some((request) => request.status === 'pending' || request.status === 'added')) && requests.length ? <ul className="m-0 list-none p-0 pb-[12px] [&>li]:flex [&>li]:min-h-[44px] [&>li]:items-center [&>li]:justify-between [&>li]:gap-[12px] [&>li]:border-b [&>li]:border-line [&>li]:text-[15px] [&>li:last-child]:border-b-0" aria-live="polite">
      {requests.map((request) => <li key={request.id}><span className="min-w-0 py-[10px] font-normal text-ink">{request.name}</span><span className="shrink-0 text-[14px] leading-[20px] text-ink-2">{request.status === 'added' ? '추가됨' : request.status === 'review' ? '개발자 확인 중' : request.status === 'failed' ? '보내지 못함' : '확인 중'}</span></li>)}
    </ul> : null}
  </div>;
}
