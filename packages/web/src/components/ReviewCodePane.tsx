import { useMemo, useState } from 'react';
import type { Side } from '@criever/shared';
import { api } from '../api';
import { useComments, useInvalidate, useRangeReadOnly } from '../hooks';
import { useStore } from '../store';
import { CodePane } from './CodePane';
import { Composer } from './Composer';
import type { RowExtra } from './DiffTable';
import { DraftCard } from './ThreadCard';
import { ThreadCardFull } from './ThreadCardFull';

export function ReviewCodePane() {
  const s = useStore(); const path = s.currentPath; const c = useComments().data; const invalidate = useInvalidate();
  const readOnly = useRangeReadOnly();
  const [editing, setEditing] = useState<string | null>(null);

  const onGutterClick = (side: Side, line: number, shift: boolean) => {
    if (!path) return;
    if (shift && s.selection && s.selection.side === side) {
      const from = Math.min(s.selection.from, line), to = Math.max(s.selection.to, line);
      s.setSelection({ side, from, to }); s.setComposer({ path, line: to, side, endLine: from });
    } else { s.setSelection({ side, from: line, to: line }); s.setComposer({ path, line, side }); }
  };
  const close = () => { s.setComposer(null); s.setSelection(null); };

  const extras = useMemo<RowExtra[]>(() => {
    if (!c || !path) return [];
    const th = c.threads.filter(t => t.displayPath === path && t.displayLine != null)
      .map(t => ({ key: `t${t.root.id}`, afterLine: { side: t.displaySide, line: t.displayLine! }, node: <ThreadCardFull thread={t} draftReplies={c.drafts.filter(d => d.parentId === t.root.id)} /> }));
    const dr = c.drafts.filter(d => d.path === path && d.parentId == null).map(d => ({
      key: `d${d.id}`, afterLine: { side: d.side, line: d.line },
      node: editing === d.id
        ? <Composer target={{ path: d.path, line: d.line, side: d.side }} initial={d.body} onCancel={() => setEditing(null)} onSave={async b => { await api.updateDraft(d.id, b); setEditing(null); invalidate(); }} />
        : <DraftCard draft={d} footer={<><button className="btn sm ghost" data-testid={`draft/${d.id}/edit`} onClick={() => setEditing(d.id)}>Edit</button><button className="btn sm ghost" data-testid={`draft/${d.id}/delete`} onClick={async () => { await api.deleteDraft(d.id); invalidate(); }}>Delete</button></>} />,
    }));
    const cm = s.composer && s.composer.path === path && s.composer.parentId == null ? [{
      key: 'composer', afterLine: { side: s.composer.side, line: s.composer.line },
      node: <Composer target={s.composer} onCancel={close} onSave={async b => { await api.addDraft({ path, line: s.composer!.line, side: s.composer!.side, body: b }); close(); invalidate(); s.showToast('Saved locally. Publish sends all drafts at once.'); }} />,
    }] : [];
    return [...th, ...dr, ...cm];
  }, [c, path, s.composer, editing, invalidate]);

  // A fileDeleted thread has no line to render under (its file is gone), but its displayPath still
  // names the file it was on — this is the "obvious place" the user looks for it.
  const unanchored = useMemo(() => {
    if (!c || !path) return null;
    const orphans = c.threads.filter(t => t.displayPath === path && t.status?.status === 'fileDeleted');
    if (!orphans.length) return null;
    return <div className="unanchored" data-testid="code/unanchored">{orphans.map(t => <ThreadCardFull key={t.root.id} thread={t} draftReplies={c.drafts.filter(d => d.parentId === t.root.id)} />)}</div>;
  }, [c, path]);

  if (readOnly) return <CodePane onGutterClick={() => {}} />;
  return <CodePane extras={extras} unanchored={unanchored} onGutterClick={onGutterClick} selection={s.selection} />;
}
