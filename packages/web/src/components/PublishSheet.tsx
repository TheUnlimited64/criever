import { useState } from 'react';
import type { Draft, PublishResult } from '@criever/shared';
import { api } from '../api';
import { useComments, useInvalidate, usePr } from '../hooks';
import { useStore } from '../store';
import { Overlay } from './Overlay';

export function PublishSheet() {
  const { setOverlay, showToast } = useStore(); const drafts = useComments().data?.drafts ?? []; const pr = usePr().data; const invalidate = useInvalidate();
  const [results, setResults] = useState<Record<string, PublishResult>>({}); const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Draft[] | null>(null);
  const close = () => { setOverlay(null); invalidate(); };
  const publish = async () => {
    setRows([...drafts].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    setBusy(true); let ok = 0, failed = false;
    await api.publish(r => { setResults(x => ({ ...x, [r.draftId]: r })); if (r.ok) ok++; else failed = true; });
    setBusy(false); invalidate();
    if (!failed) { showToast(`Published ${ok} comment${ok === 1 ? '' : 's'}`); setOverlay(null); }
  };
  const sorted = rows ?? [...drafts].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const pendingResults = Object.values(results).filter(r => r.pending === true);
  return (
    <Overlay onClose={close}>
      <div data-testid="publishSheet">
        <div className="sheet-hd">Publish {sorted.length} draft{sorted.length === 1 ? '' : 's'} to PR #{pr?.id} <span className="sub">as inline comments and threaded replies, in this order</span></div>
        <div className="sheet-list">
          {sorted.length === 0 && <div className="sheet-row"><div>Nothing to publish.</div></div>}
          {sorted.map(d => { const r = results[d.id]; return (
            <div key={d.id} className={`sheet-row ${r ? (r.ok ? 'ok' : r.pending ? 'pending' : 'failed') : ''}`} data-testid={`publishSheet/row/${d.id}`}>
              <div><div className="loc">{d.path}:{d.line} · {d.side} side{d.parentId ? ` · reply to #${d.parentId}` : ''}</div>{d.body.split('\n')[0]}
                {r?.pending && <div className="chip amber" data-testid={`publishSheet/row/${d.id}/pending`}>pending · not published{r.error ? ` — ${r.error}` : ''}</div>}
                {r && !r.ok && !r.pending && <div className="chip amber" data-testid={`publishSheet/row/${d.id}/error`}>{r.error}</div>}</div>
              {!r && !busy && <button className="btn sm ghost" data-testid={`publishSheet/row/${d.id}/remove`} onClick={async () => { await api.deleteDraft(d.id); invalidate(); }}>remove</button>}
              {r?.ok && <span className="chip grey">published</span>}
            </div>); })}
        </div>
        <div className="sheet-ft"><span className="grow" data-testid="publishSheet/pendingNotice">{pendingResults.length > 0 ? `${pendingResults.length} local-only draft${pendingResults.length === 1 ? '' : 's'} ${pendingResults.length === 1 ? 'stays' : 'stay'} pending until the remote source head includes the anchor commit.` : `Anchored to ${pr?.sourceHead.slice(0, 7)}. If one fails, the rest stay drafts.`}</span>
          <button className="btn" data-testid="publishSheet/cancel" onClick={close}>{Object.keys(results).length ? 'Close' : 'Cancel'}</button>
          <button className="btn primary" data-testid="publishSheet/confirm" disabled={busy || sorted.length === 0 || Object.keys(results).length > 0} onClick={publish}>{busy ? 'Publishing…' : 'Publish'}</button></div>
      </div>
    </Overlay>
  );
}
