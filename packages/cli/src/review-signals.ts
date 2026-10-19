import type { BbComment, DiscussionItem, ReviewDecision, ReviewSignals, WorkspacePullRequest } from '@criever/shared';
import { timeOf } from '@criever/shared';
import { sameUuid, type BitbucketClient, type RawParticipant, type RawPr } from './bitbucket';

const MAX_DISCUSSION = 200;

const decisionOf = (p: RawParticipant): ReviewDecision | null =>
  p.state === 'changes_requested' ? 'changes_requested' : p.state === 'approved' || p.approved === true ? 'approved' : null;

const latest = (times: (string | null)[]) =>
  times.reduce<string | null>((a, b) => b !== null && (a === null || timeOf(b) > timeOf(a)) ? b : a, null);

/** Classifies other people's live comments; a reply counts only inside a thread the user joined. */
export function discussionFrom(comments: readonly BbComment[]): { mineAt: string | null; items: DiscussionItem[] } {
  const byId = new Map(comments.map(c => [c.id, c]));
  const rootOf = (c: BbComment) => {
    const seen = new Set<number>();
    let at = c;
    while (at.parentId !== null && !seen.has(at.id)) { seen.add(at.id); const parent = byId.get(at.parentId); if (!parent) break; at = parent; }
    return at.id;
  };
  const live = comments.filter(c => !c.deleted);
  const joined = new Set(live.filter(c => c.author.isMe).map(rootOf));
  return {
    mineAt: latest(live.filter(c => c.author.isMe).map(c => c.createdOn)),
    items: live.filter(c => !c.author.isMe).map(c => ({
      id: `comment:${c.id}`, kind: c.parentId !== null && joined.has(rootOf(c)) ? 'reply' : 'comment', author: c.author.name, at: c.createdOn,
    })),
  };
}

/**
 * Reads the current user's provider-side review activity for one pull request and records what
 * others have said since. `head` is the full commit ID of the source branch.
 */
export async function collectSignals(c: BitbucketClient, ws: string, repo: string, pr: RawPr, opts: {
  previous: WorkspacePullRequest | undefined; head: () => Promise<string>; now: Date;
}): Promise<ReviewSignals> {
  const [me, comments] = await Promise.all([c.currentUserUuid(), c.listComments(ws, repo, pr.id)]);
  const previous = opts.previous?.signals;
  const { mineAt, items } = discussionFrom(comments);
  const participants = pr.participants ?? [];
  const mine = participants.find(p => sameUuid(p.user?.uuid, me));
  const myDecision = mine ? decisionOf(mine) : null;
  const decisionAt = myDecision === null ? null
    : mine?.participated_on ?? (previous?.myDecision === myDecision ? previous.myActivityAt : null) ?? opts.now.toISOString();
  const myActivityAt = latest([mineAt, decisionAt]);
  const feedback: DiscussionItem[] = participants.flatMap(p => {
    const decision = decisionOf(p);
    return decision && p.participated_on && !sameUuid(p.user?.uuid, me)
      ? [{ id: `decision:${p.user?.uuid ?? p.user?.display_name}`, kind: 'feedback' as const, author: p.user?.display_name ?? 'Another reviewer', at: p.participated_on, decision }] : [];
  });
  const discussion = [...items, ...feedback].sort((a, b) => timeOf(b.at) - timeOf(a.at)).slice(0, MAX_DISCUSSION);
  if (myActivityAt === null) return { myActivityAt, myDecision, observedHead: null, commitsChanged: false, discussion };

  const head = await opts.head();
  if (previous && previous.myActivityAt === myActivityAt) {
    return { myActivityAt, myDecision, observedHead: previous.observedHead,
      commitsChanged: previous.observedHead !== null ? previous.observedHead !== head : previous.commitsChanged, discussion };
  }
  // First sight of this review activity: commit dates are all there is to compare against.
  const commits = await c.listCommits(ws, repo, pr.id);
  const newer = commits.some(commit => timeOf(commit.date) > timeOf(myActivityAt));
  if (!newer) return { myActivityAt, myDecision, observedHead: head, commitsChanged: false, discussion };
  const reviewed = commits.filter(commit => timeOf(commit.date) <= timeOf(myActivityAt))
    .reduce<typeof commits[number] | null>((a, b) => !a || timeOf(b.date) > timeOf(a.date) ? b : a, null);
  const observedHead = reviewed ? await c.resolveRevision(ws, repo, { branch: pr.source.branch, repository: pr.source.repository, commit: { hash: reviewed.hash } }) : null;
  return { myActivityAt, myDecision, observedHead, commitsChanged: true, discussion };
}
