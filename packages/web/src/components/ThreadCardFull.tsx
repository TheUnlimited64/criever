import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CommentsResponse, Draft, Thread } from '@criever/shared';
import { api } from '../api';
import { useInvalidate } from '../hooks';
import { useStore } from '../store';
import { Composer } from './Composer';
import { SinceDiff } from './SinceDiff';
import { ThreadCard } from './ThreadCard';

/** A thread card with its Reply/Resolve wiring, usable anywhere a thread needs to be fully
 *  interactive — not just under its line in the code pane. Every thread returned by the API must
 *  be reachable and resolvable, including ones with no line to render under.
 *  Takes `draftReplies` as a prop rather than calling useComments() itself: this mounts fresh
 *  per thread whenever a file's extras are rebuilt, and an extra query observer per card would
 *  fire its own background refetch (default staleTime 0) right when the diff fetch also needs
 *  to land — the caller already has the same `comments` data from its own subscription. */
export function ThreadCardFull({ thread, draftReplies }: { thread: Thread; draftReplies: Draft[] }) {
  const s = useStore();
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);

  const resolve = async (id: number) => {
    const prev = qc.getQueryData<CommentsResponse>(['comments']);
    qc.setQueryData<CommentsResponse>(['comments'], old => old && {
      ...old, threads: old.threads.map(t => t.root.id === id ? { ...t, root: { ...t.root, resolved: true } } : t),
    });
    try { await api.resolve(id); invalidate(); s.showToast('Resolved on Bitbucket'); }
    catch (e) { qc.setQueryData(['comments'], prev); void qc.invalidateQueries({ queryKey: ['comments'] }); s.showToast(`Resolve failed: ${(e as Error).message}`); }
  };

  return (
    <ThreadCard thread={thread} footer={<>
      <span className="grow" />
      <button className="btn sm" data-testid={`thread/${thread.root.id}/reply`} onClick={() => setReplying(true)}>Reply</button>
      {!thread.root.resolved && <button className="btn sm primary" data-testid={`thread/${thread.root.id}/resolve`} onClick={() => resolve(thread.root.id)}>Resolve</button>}
    </>}>
      <SinceDiff thread={thread} />
      {draftReplies.map(d => (
        <div className="reply draft-reply" key={d.id} data-testid={`thread/${thread.root.id}/draftReply/${d.id}`}>
          {editing === d.id
            ? <Composer target={{ path: d.path, line: d.line, side: d.side, parentId: d.parentId }} initial={d.body} onCancel={() => setEditing(null)} onSave={async b => { await api.updateDraft(d.id, b); setEditing(null); invalidate(); }} />
            : <><div className="card-hd"><span className="avatar">me</span><span className="who">you</span><span className="chip blue">draft reply · not published</span></div>
              <div className="card-body" style={{ paddingLeft: 0 }}>{d.body.split('\n').map((l, i) => <p key={i}>{l}</p>)}</div>
              <div style={{ display: 'flex', gap: 6 }}><button className="btn sm ghost" data-testid={`thread/${thread.root.id}/draftReply/${d.id}/edit`} onClick={() => setEditing(d.id)}>Edit</button><button className="btn sm ghost" data-testid={`thread/${thread.root.id}/draftReply/${d.id}/delete`} onClick={async () => { await api.deleteDraft(d.id); invalidate(); }}>Delete</button></div></>}
        </div>
      ))}
      {replying && <div className="reply"><Composer target={{ path: thread.displayPath ?? '', line: thread.displayLine ?? 1, side: thread.displaySide, parentId: thread.root.id }} onCancel={() => setReplying(false)}
        onSave={async b => { await api.addDraft({ path: thread.anchor?.path ?? thread.displayPath ?? '', line: thread.anchor?.line ?? thread.displayLine ?? 1, side: thread.displaySide, body: b, parentId: thread.root.id }); setReplying(false); invalidate(); }} /></div>}
    </ThreadCard>
  );
}
