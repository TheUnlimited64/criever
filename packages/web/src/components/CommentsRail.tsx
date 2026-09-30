import type { Draft, Thread } from '@criever/shared';
import { changedSinceHeading } from './changedSince';
import { emojify } from './emoji';
import { useComments, usePr } from '../hooks';
import { useStore } from '../store';
import { Avatar } from './ThreadCard';
import { ThreadCardFull } from './ThreadCardFull';

const first = (s: string) => emojify(s.split('\n')[0] ?? '');
export function CommentsRail() {
  const c = useComments().data; const local = usePr().data?.kind === 'local'; const { openDiff, setFocusedThread } = useStore();
  if (!c) return <aside className="pane rail" data-testid="comments" aria-label="Review comments"><div className="pane-hd">Comments</div><div className="empty" role="status">Loading comments…</div></aside>;
  // Resolved wins over authorship (a resolved thread always reads as resolved, no matter who wrote
  // it); among the rest, the agent group wins over "changed since" — the point of the group is to
  // review everything the agent found as one batch, and its card still shows the "changed" chip.
  const isAgent = (t: Thread) => local && !t.root.author.isMe;
  const agent = c.threads.filter(t => !t.root.resolved && isAgent(t));
  const changed = c.threads.filter(t => !t.root.resolved && !isAgent(t) && (t.status?.status === 'changed' || t.status?.status === 'deleted' || t.status?.status === 'fileDeleted'));
  const open = c.threads.filter(t => !t.root.resolved && !isAgent(t) && !changed.includes(t));
  const resolved = c.threads.filter(t => t.root.resolved);
  const go = (t: Thread) => { if (t.displayPath) openDiff(t.displayPath); setFocusedThread(t.root.id); setTimeout(() => document.getElementById(`thread-${t.root.id}`)?.scrollIntoView({ block: 'center' }), 100); };
  const goDraft = (d: Draft) => { openDiff(d.path); setTimeout(() => document.querySelector(`[data-testid="draft/${d.id}"]`)?.scrollIntoView({ block: 'center' }), 100); };
  const Group = ({ id, title, n, children }: { id: string; title: string; n: number; children: React.ReactNode }) => (
    <div className="group" data-testid={`comments/group/${id}`}><div className="group-hd">{title} <span className="n" data-testid={`comments/group/${id}/count`}>{n}</span></div>{children}</div>
  );
  // The avatar-initials treatment is the same one the thread cards use, so a colleague's comment
  // reads as theirs at a glance in both places; yours stays the quieter plain avatar colour.
  const Item = ({ t, pip, muted, agentPip }: { t: Thread; pip: string; muted?: boolean; agentPip?: boolean }) => (
    <button className={`item av ${muted ? 'muted' : ''}`} title={`${t.root.author.name} · ${t.displayPath ?? 'General comment'} · ${muted ? 'Resolved' : 'Open'}\n${first(t.root.body)}`} data-testid={`comments/item/${t.root.id}`} onClick={() => go(t)}>
      <span className={`pip ${pip}`} /><Avatar c={t.root} agent={!!agentPip} />
      <span><span className="loc">{t.displayPath ? `${t.displayPath.split('/').pop()}:${t.displayLine ?? '—'}` : 'General comment'}</span><span className="txt">{first(t.root.body)}</span></span>
    </button>
  );
  // A general PR comment has no path to navigate to and back — its only home is right here, so it
  // gets the full interactive card (reply + resolve) instead of the click-through preview row.
  const Row = ({ t, pip, muted, agentPip }: { t: Thread; pip: string; muted?: boolean; agentPip?: boolean }) =>
    t.displayPath ? <Item key={t.root.id} t={t} pip={pip} muted={muted} agentPip={agentPip} />
      : <div className="item-card" key={t.root.id} data-testid={`comments/item/${t.root.id}`}><ThreadCardFull thread={t} draftReplies={c.drafts.filter(d => d.parentId === t.root.id)} /></div>;
  return (
    <aside className="pane rail" data-testid="comments" aria-label="Review comments">
      <div className="pane-hd">Comments <span className="count">{c.threads.length + c.drafts.length}</span></div>
      <p className="rail-summary">Select a comment to open its code. General comments stay here.</p>
      <Group id="drafts" title="Drafts" n={c.drafts.length}>{c.drafts.map(d => (
        <button key={d.id} className="item" title={first(d.body)} data-testid={`comments/draft/${d.id}`} onClick={() => goDraft(d)}><span className="pip draft" /><span><span className="loc">{d.path ? `${d.path.split('/').pop()}:${d.line}` : 'General comment'}{d.parentId ? ' · reply' : ''}</span><span className="txt">{first(d.body)}</span></span></button>))}
        {c.drafts.length === 0 && <p className="group-empty">No drafts. Select a code line to comment.</p>}
      </Group>
      {local && <Group id="agent" title="From the agent" n={agent.length}>{agent.map(t => <Row key={t.root.id} t={t} pip="agent" agentPip />)}</Group>}
      <Group id="changed" title={changedSinceHeading(changed)} n={changed.length}>{changed.map(t => <Row key={t.root.id} t={t} pip="changed" />)}</Group>
      <Group id="open" title="Open" n={open.length}>{open.map(t => <Row key={t.root.id} t={t} pip="open" />)}</Group>
      <Group id="resolved" title="Resolved" n={resolved.length}>{resolved.map(t => <Row key={t.root.id} t={t} pip="resolved" muted />)}</Group>
    </aside>
  );
}
