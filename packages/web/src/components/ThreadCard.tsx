import { useState } from 'react';
import type { BbComment, Draft, Thread } from '@criever/shared';
import { usePr } from '../hooks';
import { useStore } from '../store';
import { changedSinceChip } from './changedSince';
import { flavorForProviderKind, renderMarkdown } from './markdown';

const Body = ({ body, flavor }: { body: string; flavor: ReturnType<typeof flavorForProviderKind> }) => (
  <div className="mdPreview" dangerouslySetInnerHTML={{ __html: renderMarkdown(body, flavor) }} />
);

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400); return d === 1 ? 'yesterday' : `${d} days ago`;
}
// A local review only ever has 'me' and 'agent' authors; a Bitbucket PR has no agent
// concept at all, so "not me, in a local review" is exactly "the agent" — no extra field needed.
export const Avatar = ({ c, agent }: { c: BbComment; agent: boolean }) => <span className={`avatar ${agent ? 'agent' : c.author.isMe ? '' : 'other'}`}>{c.author.initials}</span>;
// The author line already shows the agent's name, so the badge marks the ROLE, not the name again.
const AgentBadge = ({ testid }: { testid: string }) => <span className="chip blue" data-testid={testid}>agent</span>;

export function ThreadCard({ thread, footer, children }: { thread: Thread; footer?: React.ReactNode; children?: React.ReactNode }) {
  const focused = useStore(s => s.focusedThread) === thread.root.id;
  const pr = usePr();
  const local = pr.data?.kind === 'local';
  const flavor = flavorForProviderKind(pr.data?.kind ?? 'local');
  const st = thread.status?.status;
  const [open, setOpen] = useState(false);
  const collapsed = thread.root.resolved && !open;
  const chip = thread.root.resolved ? { cls: 'grey', text: 'resolved' } : st === 'changed' ? { cls: 'amber', text: changedSinceChip(thread.root.author) } : st === 'deleted' ? { cls: 'amber', text: 'line removed' } : st === 'fileDeleted' ? { cls: 'amber', text: 'file removed' } : { cls: 'grey', text: 'open' };
  const cls = ['card', !thread.root.resolved && (st === 'changed' || st === 'deleted') ? 'changed' : '', focused ? 'focused' : '', collapsed ? 'collapsed' : ''].join(' ');
  const rootIsAgent = local && !thread.root.author.isMe;
  return (
    <div className={cls} data-testid={`thread/${thread.root.id}`} id={`thread-${thread.root.id}`}>
      <div className="card-hd"><Avatar c={thread.root} agent={rootIsAgent} /><span className="who">{thread.root.author.isMe ? 'you' : thread.root.author.name}</span>
        {rootIsAgent && <AgentBadge testid={`thread/${thread.root.id}/agentBadge`} />}
        <span className="when">{timeAgo(thread.root.createdOn)}{thread.anchor ? ` · on ${thread.anchor.anchorCommit.slice(0, 7)}` : ''}</span>
        <span className={`chip ${chip.cls}`} data-testid={`thread/${thread.root.id}/chip`}>{chip.text}</span>
        {thread.root.resolved && <button className="expand" data-testid={`thread/${thread.root.id}/expand`} onClick={() => setOpen(o => !o)}>{collapsed ? '▸' : '▾'}</button>}</div>
      <div className="card-body" data-testid={`thread/${thread.root.id}/body`}><Body body={thread.root.body} flavor={flavor} /></div>
      {thread.replies.map(r => {
        const replyIsAgent = local && !r.author.isMe;
        return (
          <div className="reply" key={r.id} data-testid={`thread/${thread.root.id}/reply/${r.id}`}>
            <div className="card-hd"><Avatar c={r} agent={replyIsAgent} /><span className="who">{r.author.isMe ? 'you' : r.author.name}</span>
              {replyIsAgent && <AgentBadge testid={`thread/${thread.root.id}/reply/${r.id}/agentBadge`} />}
              <span className="when">{timeAgo(r.createdOn)}</span></div>
            <div className="card-body" style={{ paddingLeft: 0 }}><Body body={r.body} flavor={flavor} /></div>
          </div>
        );
      })}
      {children}
      {footer && <div className="card-ft">{footer}</div>}
    </div>
  );
}

export function DraftCard({ draft, footer }: { draft: Draft; footer?: React.ReactNode }) {
  const flavor = flavorForProviderKind(usePr().data?.kind ?? 'local');
  return (
    <div className="card draft" data-testid={`draft/${draft.id}`}>
      <div className="card-hd"><span className="avatar">me</span><span className="who">you</span><span className="chip blue">{draft.parentId ? 'draft reply · not published' : 'draft · not published'}</span></div>
      <div className="card-body" data-testid={`draft/${draft.id}/body`}><Body body={draft.body} flavor={flavor} /></div>
      {footer && <div className="card-ft">{footer}</div>}
    </div>
  );
}
