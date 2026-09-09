import { useState } from 'react';
import type { Thread } from '@criever/shared';
import { useDiff, usePr } from '../hooks';
import { useStore } from '../store';
import { DiffTable } from './DiffTable';

export function SinceDiff({ thread }: { thread: Thread }) {
  const [open, setOpen] = useState(false);
  const pr = usePr().data;
  const openDiff = useStore(s => s.openDiff); const setRange = useStore(s => s.setRange);
  const st = thread.status; const a = thread.anchor;
  const isSince = !!a && !!st && (st.status === 'changed' || st.status === 'deleted');
  const path = thread.displayPath ?? a?.path ?? null;
  const q = useDiff(open && isSince ? path : null, { base: a?.anchorCommit ?? null, context: 3 });
  if (!isSince || !a || !st) return null;
  const target = st.status === 'changed' ? st.hunk : null;
  // pick the hunk whose new range contains the -U0 hunk's newStart (context 3 widens the ranges)
  const hunk = q.data?.file?.hunks.find(h => target ? (target.newStart >= h.newStart && target.newStart <= h.newStart + Math.max(h.newLen, 1)) : true) ?? q.data?.file?.hunks[0];
  return (
    <>
      <div className="card-ft" style={{ borderTop: 0, paddingTop: 0 }}>
        <button className="btn sm" data-testid={`thread/${thread.root.id}/showChanged`} onClick={() => setOpen(o => !o)}>{open ? '▾' : '▸'} {st.status === 'deleted' ? 'show removed lines' : 'show what changed'}</button>
      </div>
      {open && (
        <div className="since" data-testid={`thread/${thread.root.id}/since`}>
          <div className="since-hd">{st.status === 'deleted' ? 'these lines were removed,' : 'this hunk,'} <code>{a.anchorCommit.slice(0, 7)}</code> → <code>{pr?.sourceHead.slice(0, 7)}</code>
            <span style={{ marginLeft: 'auto' }}><button style={{ color: 'var(--accent)' }} data-testid={`thread/${thread.root.id}/wholeFileSince`} onClick={() => { openDiff(path!); setRange({ base: a.anchorCommit, head: pr!.sourceHead }); }}>whole file since my comment</button></span></div>
          {hunk && q.data?.file && <DiffTable file={{ ...q.data.file, hunks: [hunk] }} path={path!} split={false} extras={[]} cursorLine={null} onGutterClick={() => {}} onExpand={() => {}} />}
          {q.isLoading && <div className="empty">Loading…</div>}
        </div>
      )}
    </>
  );
}
