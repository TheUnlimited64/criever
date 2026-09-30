import { useMemo, useState } from 'react';
import type { ChangedFile } from '@criever/shared';
import { api } from '../api';
import { useFiles, useInvalidate, usePr, useTree } from '../hooks';
import { useStore } from '../store';

const enc = (p: string) => encodeURIComponent(p);
const Check = () => <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m2 5.2 2.2 2.2L8.3 3" /></svg>;
const statusLabel = { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed' } as const;

export function FilesPane() {
  const files = useFiles().data ?? []; const pr = usePr().data;
  const { currentPath, openDiff, openFile, showAll, setShowAll } = useStore();
  const tree = useTree(showAll ? pr?.sourceHead ?? null : null);
  const invalidate = useInvalidate();
  const [filter, setFilter] = useState('');
  const viewedCount = files.filter(f => f.viewed).length;
  const adds = files.reduce((n, f) => n + f.additions, 0), dels = files.reduce((n, f) => n + f.deletions, 0);

  const rows = useMemo(() => {
    const list: { path: string; f?: ChangedFile }[] = showAll ? (tree.data ?? []).map(t => ({ path: t.path, f: files.find(x => x.path === t.path) })) : files.map(f => ({ path: f.path, f }));
    return list.filter(r => r.path.toLowerCase().includes(filter.toLowerCase()));
  }, [files, tree.data, showAll, filter]);

  const groups = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const r of rows) { const dir = r.path.includes('/') ? r.path.slice(0, r.path.lastIndexOf('/')) : '/'; (m.get(dir) ?? m.set(dir, []).get(dir)!).push(r); }
    return [...m.entries()];
  }, [rows]);

  const toggleViewed = async (f: ChangedFile) => { await api.setViewed(f.path, !f.viewed); invalidate(); };

  return (
    <aside className="pane files" data-testid="files" aria-label="Review files">
      <div className="pane-hd">Files <span className="count" data-testid="files/count">{files.length} · {viewedCount} viewed</span>
        <span className="seg">
          <button className={showAll ? '' : 'on'} aria-pressed={!showAll} data-testid="files/modeChanged" onClick={() => setShowAll(false)}>Changed files</button>
          <button className={showAll ? 'on' : ''} aria-pressed={showAll} data-testid="files/modeAll" onClick={() => setShowAll(true)}>All files</button>
        </span>
      </div>
      <div className="filter">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
        <input aria-label="Filter files by path" placeholder="Filter files by path" value={filter} onChange={e => setFilter(e.target.value)} data-testid="files/filter" />
      </div>
      <div className="review-progress"><span>{viewedCount} of {files.length} files reviewed</span><progress aria-label="Files reviewed" value={viewedCount} max={Math.max(files.length, 1)} /></div>
      <div className="tree" data-testid="files/tree">
        {rows.length === 0 && <div className="empty">{filter ? 'No files match this filter.' : 'No files in this comparison.'}</div>}
        {groups.map(([dir, items]) => (
          <div key={dir}>
            <div className="dir mono" data-testid={`files/dir/${enc(dir)}`}>{dir}</div>
            {items.map(({ path, f }) => (
              <div key={path} className={`file ${path === currentPath ? 'on' : ''}`} data-testid={`files/file/${enc(path)}`}
                onClick={() => (f ? openDiff(path) : openFile(path, pr?.sourceHead ?? null))}>
                <button className={`chk ${f?.viewed ? 'on' : ''}`} role="checkbox" aria-checked={!!f?.viewed} disabled={!f} aria-label={`Mark ${path} as ${f?.viewed ? 'not reviewed' : 'reviewed'}`} title={f?.viewed ? 'Reviewed · click to undo' : 'Mark as reviewed'} data-testid={`files/file/${enc(path)}/viewed`}
                  onClick={e => { e.stopPropagation(); if (f) void toggleViewed(f); }}>{f?.viewed && <Check />}</button>
                <button className="file-open" aria-current={path === currentPath ? 'true' : undefined} aria-label={`Open ${path}${f ? ` · ${statusLabel[f.status]}` : ''}`} title={path}>
                  <span className={`name ${f?.viewed ? 'viewed' : ''}`} data-testid={`files/file/${enc(path)}/name`}>{path.split('/').pop()}</span>
                <span className="meta">
                  {!!f?.draftCount && <span className="pip draft" role="img" aria-label={`${f.draftCount} drafts`} title="has drafts" />}
                  {!!f?.changedCount && <span className="pip changed" role="img" aria-label="Changed since your comment" title="changed since your comment" />}
                  {!!f?.openCount && <span className="pip open" role="img" aria-label={`${f.openCount} open threads`} title="open threads" />}
                  {f && <span className={`st ${f.status}`} aria-label={statusLabel[f.status]} title={statusLabel[f.status]}>{f.status}</span>}
                </span>
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="files-foot" data-testid="files/footer"><span>+{adds} −{dels}</span><span>merge-base {pr?.mergeBase.slice(0, 7)}</span></div>
    </aside>
  );
}
