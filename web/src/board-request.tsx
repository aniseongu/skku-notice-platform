import { useEffect, useId, useRef, useState } from 'react';
import { AlertIcon } from './alert-icon';
import { SETTINGS_ACTION, SETTINGS_INPUT, SOLID_BUTTON, GHOST_BUTTON } from './cls';
import { Setting } from './platform-settings';
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
    <Setting name="찾는 게시판이 없나요?" help="주소를 적으면 보통 30분 안에 확인해서 모두가 고를 수 있게 추가해요. 주소가 없거나 확인이 안 되면 개발자가 살펴봐요">
      {open ? <div ref={formRef} className="flex flex-col gap-[8px]">
        <input className={`${SETTINGS_INPUT} w-full font-normal`} aria-label="게시판 이름" placeholder="게시판 이름" value={name} maxLength={60} required disabled={busy} onChange={(e) => setName(e.currentTarget.value)} />
        <input className={`${SETTINGS_INPUT} w-full font-normal`} type="url" aria-label="주소 (선택)" placeholder="주소 (선택)" value={address} maxLength={400} disabled={busy} aria-invalid={invalid} aria-describedby={invalid ? addressErrorId : undefined} onChange={(e) => setAddress(e.currentTarget.value)} />
        {invalid ? <p id={addressErrorId} className="field-note m-0 text-left text-[14px] leading-[20px] text-danger" role="alert">https로 시작하는 성균관대 주소인지 확인해 주세요</p> : null}
        {error ? <p className="field-note m-0 text-left text-[14px] leading-[20px] text-danger" role="alert"><AlertIcon />{error}</p> : null}
        {!name.trim() ? <p className="field-note m-0 text-left text-[14px] leading-[20px] text-ink-2" role="status">게시판 이름을 적어 주세요</p> : null}
        <div className="flex gap-[8px] min-[720px]:justify-end">
          <button type="button" disabled={busy} onClick={() => setOpen(false)} className={GHOST_BUTTON}>취소</button>
          <button type="button" disabled={busy || !name.trim() || invalid} onClick={() => { void submit(); }} className={SOLID_BUTTON}>{busy ? '보내고 있어요' : '요청 보내기'}</button>
        </div>
      </div> : null}
      {open ? null : <button type="button" aria-expanded={false} disabled={busy} onClick={() => setOpen(true)} className={`${SETTINGS_ACTION} shrink-0 self-end`}>추가 요청</button>}
    </Setting>
    {(open || requests.some((request) => request.status === 'pending' || request.status === 'added')) && requests.length ? <ul className="m-0 list-none border-t border-line p-0 pb-[12px] [&>li]:flex [&>li]:min-h-[44px] [&>li]:items-center [&>li]:justify-between [&>li]:gap-[12px] [&>li]:border-b [&>li]:border-line [&>li]:text-[15px] [&>li:last-child]:border-b-0" aria-live="polite">
      {requests.map((request) => <li key={request.id}><span className="min-w-0 py-[10px] font-normal text-ink">{request.name}</span><span className="shrink-0 text-[14px] leading-[20px] text-ink-2">{request.status === 'added' ? '추가됨' : request.status === 'review' ? '개발자 확인 중' : request.status === 'failed' ? '보내지 못함' : '확인 중'}</span></li>)}
    </ul> : null}
  </div>;
}
