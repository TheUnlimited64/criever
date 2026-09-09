import { useEffect, useState } from 'react';
import { useStore } from '../store';
/** `rev` changes whenever the pane's rendered content does. The rows searched here are DOM the code
 *  pane fills in asynchronously, so without it the bar keeps whatever it counted the moment it
 *  opened — "no matches" against a file that hadn't rendered yet, or stale hits after ] moves on. */
export function FindBar({ container, rev }: { container: React.RefObject<HTMLDivElement | null>; rev: string }) {
  const setOverlay = useStore(s => s.setOverlay); const [q, setQ] = useState(''); const [i, setI] = useState(0); const [n, setN] = useState(0);
  useEffect(() => {
    const rows = [...(container.current?.querySelectorAll<HTMLTableRowElement>('tr.line') ?? [])];
    rows.forEach(r => r.classList.remove('find-hit', 'find-current'));
    if (!q) { setN(0); return; }
    const hits = rows.filter(r => (r.querySelector('td.src')?.textContent ?? '').toLowerCase().includes(q.toLowerCase()));
    hits.forEach(r => r.classList.add('find-hit')); setN(hits.length);
    const cur = hits[((i % Math.max(hits.length, 1)) + hits.length) % Math.max(hits.length, 1)];
    if (cur) { cur.classList.add('find-current'); cur.scrollIntoView({ block: 'center' }); }
    return () => rows.forEach(r => r.classList.remove('find-hit', 'find-current'));
  }, [q, i, container, rev]);
  useEffect(() => setI(0), [q]);
  return (
    <div className="findbar" data-testid="findBar">
      <input autoFocus data-testid="findBar/input" placeholder="Find in file" value={q} onChange={e => setQ(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setI(x => x + (e.shiftKey ? -1 : 1)); } if (e.key === 'Escape') setOverlay(null); }} />
      <span className="count" data-testid="findBar/count">{n ? `${((i % n) + n) % n + 1} of ${n}` : q ? 'no matches' : ''}</span>
      <button className="btn sm ghost" data-testid="findBar/prev" onClick={() => setI(x => x - 1)}>↑</button>
      <button className="btn sm ghost" data-testid="findBar/next" onClick={() => setI(x => x + 1)}>↓</button>
      <button className="btn sm ghost" onClick={() => setOverlay(null)}>✕</button>
    </div>
  );
}
