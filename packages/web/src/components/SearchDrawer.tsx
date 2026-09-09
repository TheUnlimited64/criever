import { useEffect, useState } from 'react';
import { usePr, useSearch } from '../hooks';
import { useStore } from '../store';
import { Overlay } from './Overlay';
export function SearchDrawer() {
  const { setOverlay, openFile } = useStore(); const pr = usePr().data;
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 200); return () => clearTimeout(t); }, [q]);
  const hits = useSearch(dq);
  return (
    <Overlay onClose={() => setOverlay(null)} className="palette">
      <div data-testid="repoSearch">
        <input autoFocus data-testid="repoSearch/input" placeholder={`Search in repo at ${pr?.sourceHead.slice(0, 7)} (git grep)`} value={q} onChange={e => setQ(e.target.value)} />
        {hits.data?.slice(0, 200).map((h, i) => (
          <div key={i} className="p-row" data-testid={`repoSearch/hit/${i}`} onClick={() => { openFile(h.path, pr?.sourceHead ?? null, h.line); setOverlay(null); }}>
            <span>{h.path}<span className="dim">:{h.line}</span>&nbsp;&nbsp;{h.text.trim().slice(0, 120)}</span></div>))}
        {hits.data && hits.data.length === 0 && <div className="p-row dim">No matches</div>}
        {hits.data && hits.data.length >= 500 && <div className="p-row dim">Showing the first 500 hits</div>}
        {hits.error && <div className="p-row dim">{(hits.error as Error).message}</div>}
      </div>
    </Overlay>
  );
}
