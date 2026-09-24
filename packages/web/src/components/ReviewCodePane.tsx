import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Side } from '@criever/shared';
import { api } from '../api';
import { useComments, useInvalidate, usePr, useRangeReadOnly } from '../hooks';
import { useStore } from '../store';
import { CodePane } from './CodePane';
import { Composer } from './Composer';
import type { RowExtra } from './DiffTable';
import { DraftCard } from './ThreadCard';
import { ThreadCardFull } from './ThreadCardFull';
import { AiFindingCard, AiLookoutCard, AiQuestionComposer, AiThreadCard, threadAnchor } from './AiInline';

export function ReviewCodePane() {
  const s = useStore(); const path = s.currentPath; const c = useComments().data; const invalidate = useInvalidate();
  const pr = usePr().data;
  const aiAtHead = s.viewMode !== 'file' || !s.fileAt || s.fileAt === pr?.sourceHead;
  const readOnly = useRangeReadOnly();
  const ai = useQuery({ queryKey: ['ai'], queryFn: api.ai });
  const [editing, setEditing] = useState<string | null>(null);
  const [aiTarget, setAiTarget] = useState<{ path: string } | null>(null);
  const [composerMode, setComposerMode] = useState<'comment' | 'ai'>('comment');

  const onGutterClick = (side: Side, line: number, shift: boolean) => {
    if (!path) return;
    setComposerMode('comment');
    if (shift && s.selection && s.selection.side === side) {
      const from = Math.min(s.selection.from, line), to = Math.max(s.selection.to, line);
      s.setSelection({ side, from, to }); s.setComposer({ path, line: to, side, endLine: from });
    } else { s.setSelection({ side, from: line, to: line }); s.setComposer({ path, line, side }); }
  };
  const close = useCallback(() => { s.setComposer(null); s.setSelection(null); setComposerMode('comment'); }, [s.setComposer, s.setSelection]);
  const refreshAi = useCallback(async () => { await ai.refetch(); invalidate(); }, [ai.refetch, invalidate]);

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
      node: <div className="line-composer"><div className="line-composer-choices" role="group" aria-label="Line action">
        <button type="button" aria-pressed={composerMode === 'comment'} onClick={() => setComposerMode('comment')}>PR comment</button>
        {aiAtHead && <button type="button" aria-pressed={composerMode === 'ai'} onClick={() => setComposerMode('ai')}>Ask AI privately</button>}
      </div>{composerMode === 'ai' && aiAtHead
        ? <AiQuestionComposer target={{ path, line: s.composer.line, side: s.composer.side }} onCancel={close} onSent={close} />
        : <Composer target={s.composer} onCancel={close} onSave={async b => { await api.addDraft({ path, line: s.composer!.line, side: s.composer!.side, body: b }); close(); invalidate(); s.showToast('Saved locally. Publish sends all drafts at once.'); }} />}</div>,
    }] : [];
    const guidance = (aiAtHead ? ai.data?.lookouts ?? [] : []).flatMap(item => item.anchorCommit === pr?.sourceHead && item.path === path && item.line != null ? [{
      key: `ai-lookout-${item.id}`, afterLine: { side: item.side ?? 'new', line: item.line },
      node: <AiLookoutCard lookout={item} />,
    }] : []);
    const approved = new Set(ai.data?.approvedIds ?? []);
    const findings = (aiAtHead ? ai.data?.findings ?? [] : []).filter(item => item.anchorCommit === pr?.sourceHead && item.path === path && !approved.has(item.id)).map(item => ({
      key: `ai-finding-${item.id}`, afterLine: { side: item.side, line: item.line },
       node: <AiFindingCard finding={item} harnessId={ai.data?.harnesses.find(harness => harness.id === s.selectedHarnessId)?.id ?? ai.data?.harnesses[0]?.id ?? ''} onChange={refreshAi} />,
    }));
    const contextualThreads = Object.entries(aiAtHead ? ai.data?.threads ?? {} : {}).flatMap(([threadId, messages]) => {
      const anchor = threadAnchor(threadId);
      return anchor?.path === path ? [{ key: `ai-thread-${threadId}`, afterLine: { side: anchor.side, line: anchor.line }, node: <AiThreadCard threadId={threadId} messages={messages} /> }] : [];
    });
    return [...th, ...dr, ...cm, ...guidance, ...findings, ...contextualThreads];
  }, [c, path, pr?.sourceHead, s.composer, s.selectedHarnessId, editing, invalidate, ai.data, aiAtHead, composerMode, close, refreshAi]);

  // A fileDeleted thread has no line to render under (its file is gone), but its displayPath still
  // names the file it was on — this is the "obvious place" the user looks for it.
  const unanchored = useMemo(() => {
    if (!c || !path) return null;
    const orphans = c.threads.filter(t => t.displayPath === path && t.status?.status === 'fileDeleted');
    if (!orphans.length) return null;
    return <div className="unanchored" data-testid="code/unanchored">{orphans.map(t => <ThreadCardFull key={t.root.id} thread={t} draftReplies={c.drafts.filter(d => d.parentId === t.root.id)} />)}</div>;
  }, [c, path]);

  const fileThreadId = path && pr ? `file:${encodeURIComponent(path)}:${pr.sourceHead}` : '';
  const fileThread = ai.data?.threads[fileThreadId];
  const fileAi = <div className="ai-file-context" data-testid="ai/file-thread">
    {fileThread && <AiThreadCard threadId={fileThreadId} messages={fileThread} />}
    {aiTarget?.path === path && <AiQuestionComposer target={aiTarget} onCancel={() => setAiTarget(null)} onSent={() => setAiTarget(null)} />}
  </div>;
  if (readOnly) return <CodePane onGutterClick={() => {}} />;
  return <CodePane extras={extras} unanchored={unanchored} fileAi={aiAtHead && (fileThread || aiTarget?.path === path) ? fileAi : null} onGutterClick={onGutterClick} onAskFile={aiAtHead ? () => path && setAiTarget({ path }) : undefined} selection={s.selection} />;
}
