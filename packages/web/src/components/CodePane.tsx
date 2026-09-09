import { useEffect, useRef, useState } from 'react';
import type { Side } from '@criever/shared';
import { api } from '../api';
import { useDiff, useFile, useFiles, usePr, useRangeReadOnly } from '../hooks';
import { useStore } from '../store';
import { DiffTable, FileTable, type RowExtra } from './DiffTable';
import { FindBar } from './FindBar';
import { renderMarkdown } from './markdown';

const isMarkdownPath = (p: string) => /\.(md|markdown)$/i.test(p);

export function CodePane({ extras = [], unanchored = null, onGutterClick = () => {}, selection = null }: { extras?: RowExtra[]; unanchored?: React.ReactNode; onGutterClick?: (side: Side, line: number, shift: boolean) => void; selection?: { side: Side; from: number; to: number } | null }) {
  const s = useStore(); const pr = usePr().data; const files = useFiles().data ?? [];
  const readOnly = useRangeReadOnly();
  const f = files.find(x => x.path === s.currentPath);
  const diff = useDiff(s.viewMode === 'diff' ? s.currentPath : null, { base: s.range?.base ?? null, head: s.range?.head ?? null, context: s.context });
  const fileAt = s.fileAt ?? pr?.sourceHead ?? null;
  const file = useFile(s.viewMode === 'file' ? s.currentPath : null, fileAt);
  const [preview, setPreview] = useState(false);
  const isMd = !!s.currentPath && isMarkdownPath(s.currentPath);
  // Preview mode reads a single side: the file as it will look at the head of the current range in
  // diff view (a diff has two sides, and rendering one of them as "the" markdown preview is the only
  // reading that means anything), or the file at whichever commit is already selected in file view.
  const previewAt = s.viewMode === 'file' ? fileAt : (pr?.sourceHead ?? null);
  const previewFile = useFile(isMd && preview ? s.currentPath : null, previewAt);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { s.setCursor(null); setPreview(false); if (s.jumpLine) { s.setCursor({ side: 'new', line: s.jumpLine }); setTimeout(() => bodyRef.current?.querySelector(`[data-testid="code/row/new/${s.jumpLine}"]`)?.scrollIntoView({ block: 'center' }), 50); } }, [s.currentPath, s.viewMode, s.jumpLine]);
  const expand = () => s.setContext(s.context === 3 ? 25 : 100000);
  const openVscode = async () => { try { const { url } = await api.vscodeOpen(s.currentPath!, s.cursor?.line ?? 1); window.open(url, 'criever-vscode'); } catch (e) { s.showToast((e as Error).message); } };
  if (!s.currentPath) return <section className="pane code" data-testid="code"><div className="empty">Pick a file</div></section>;
  const dir = s.currentPath.includes('/') ? s.currentPath.slice(0, s.currentPath.lastIndexOf('/') + 1) : '';
  return (
    <section className={`pane code${readOnly ? ' readonly' : ''}`} data-testid="code">
      <div className="code-hd">
        <span className="path" data-testid="code/path"><span className="dim">{dir}</span>{s.currentPath.slice(dir.length)}</span>
        {f && <span className="stat" data-testid="code/stat"><span className="p">+{f.additions}</span> <span className="m">−{f.deletions}</span></span>}
        <span className="right">
          {isMd && (
            <span className="seg">
              <button className={!preview ? 'on' : ''} data-testid="code/modeSource" onClick={() => setPreview(false)}>source</button>
              <button className={preview ? 'on' : ''} data-testid="code/modePreview" onClick={() => setPreview(true)}>preview</button>
            </span>
          )}
          <span className="seg">
            <button className={s.viewMode === 'diff' && !s.split ? 'on' : ''} data-testid="code/modeUnified" onClick={() => { if (s.split) s.toggleSplit(); if (s.viewMode !== 'diff') s.openDiff(s.currentPath!); }}>unified</button>
            <button className={s.viewMode === 'diff' && s.split ? 'on' : ''} data-testid="code/modeSplit" onClick={() => { if (!s.split) s.toggleSplit(); if (s.viewMode !== 'diff') s.openDiff(s.currentPath!); }}>split</button>
          </span>
          <select className="btn sm" data-testid="code/atPicker" value={s.viewMode === 'file' ? (s.fileAt ?? pr?.sourceHead ?? '') : ''} onChange={e => e.target.value ? s.openFile(s.currentPath!, e.target.value) : s.openDiff(s.currentPath!)}>
            <option value="">diff</option>
            <option value={pr?.sourceHead}>file at head</option>
            {pr?.commits.map(c => <option key={c.hash} value={c.hash}>file at {c.hash.slice(0, 7)} · {c.message.slice(0, 30)}</option>)}
            <option value={pr?.mergeBase}>file at merge-base</option>
          </select>
          <button className="btn sm" data-testid="code/openInVsCode" onClick={openVscode}>Open in VS Code <kbd>.</kbd></button>
        </span>
      </div>
      {s.overlay === 'find' && <FindBar container={bodyRef} rev={`${s.currentPath}|${s.viewMode}|${diff.dataUpdatedAt}|${file.dataUpdatedAt}`} />}
      <div className="code-body" ref={bodyRef} data-testid="code/body">
        {/* Kept mounted (just hidden) while previewing, not unmounted, so an open composer's
            in-progress draft survives a round trip through preview mode. */}
        <div hidden={preview}>
          {unanchored}
          {s.viewMode === 'diff' && diff.data?.file && <DiffTable file={diff.data.file} path={s.currentPath} split={s.split} extras={extras} cursorLine={s.cursor} selection={selection} onExpand={expand}
            onGutterClick={(side, line, shift) => { s.setCursor({ side, line }); onGutterClick(side, line, shift); }} />}
          {s.viewMode === 'diff' && diff.data && !diff.data.file && (
            <div className="empty" data-testid="code/noDiff">
              {s.range
                ? <>Nothing changed in this file in <code>{s.range.base.slice(0, 7)}..{s.range.head.slice(0, 7)}</code> <button data-testid="code/noDiff/clearRange" onClick={() => s.setRange(null)}>Show the whole review</button></>
                : 'No changes in this range.'}
            </div>
          )}
          {s.viewMode === 'file' && file.data && (file.data.content == null ? <div className="empty">File does not exist at this commit.</div>
            : <FileTable content={file.data.content} path={s.currentPath} extras={extras} cursorLine={s.cursor} selection={selection} onGutterClick={(side, line, shift) => { s.setCursor({ side, line }); onGutterClick(side, line, shift); }} />)}
          {(diff.error || file.error) && <div className="empty" data-testid="code/error">{String((diff.error ?? file.error as Error).message)}</div>}
        </div>
        {preview && isMd && previewFile.data?.content != null && (
          <div className="mdPreview" data-testid="code/preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(previewFile.data.content) }} />
        )}
      </div>
    </section>
  );
}
