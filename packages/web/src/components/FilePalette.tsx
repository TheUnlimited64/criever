import { useEffect, useMemo, useState } from 'react';
import { useFiles, usePr, useTree } from '../hooks';
import { useStore } from '../store';
import { fuzzyScore } from './fuzzy';
import { Overlay } from './Overlay';

export function FilePalette() {
  const { setOverlay, openDiff, openFile } = useStore(); const files = useFiles().data ?? []; const pr = usePr().data; const tree = useTree(pr?.sourceHead ?? null).data ?? [];
  const [q, setQ] = useState(''); const [i, setI] = useState(0);
  const rows = useMemo(() => {
    const changed = new Map(files.map(f => [f.path, f]));
    const all = [...files.map(f => f.path), ...tree.map(t => t.path).filter(p => !changed.has(p))];
    return all.map(p => ({ p, s: fuzzyScore(q, p), f: changed.get(p) })).filter(x => x.s != null)
      .sort((a, b) => (Number(!!b.f) - Number(!!a.f)) || (b.s! - a.s!)).slice(0, 12);
  }, [q, files, tree]);
  useEffect(() => setI(0), [q]);
  const open = (r: typeof rows[number]) => { r.f ? openDiff(r.p) : openFile(r.p, pr?.sourceHead ?? null); setOverlay(null); };
  return (
    <Overlay onClose={() => setOverlay(null)} className="palette">
      <div data-testid="filePalette">
        <input autoFocus data-testid="filePalette/input" placeholder="Jump to file… (changed files first, then whole tree)" value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setI(x => Math.min(x + 1, rows.length - 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setI(x => Math.max(x - 1, 0)); } if (e.key === 'Enter' && rows[i]) open(rows[i]!); }} />
        {rows.map((r, k) => (
          <div key={r.p} className={`p-row ${k === i ? 'on' : ''} ${r.f ? '' : 'dim'}`} data-testid={`filePalette/row/${encodeURIComponent(r.p)}`} onMouseEnter={() => setI(k)} onClick={() => open(r)}>
            <span>{r.p}{!r.f && <span className="dim"> · not in PR</span>}</span>{r.f && <span className={`st ${r.f.status} mono`}>{r.f.status}</span>}
          </div>))}
        {rows.length === 0 && <div className="p-row dim">No matches</div>}
      </div>
    </Overlay>
  );
}
