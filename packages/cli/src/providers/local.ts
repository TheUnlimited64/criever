import type { Anchor, BbComment, LocalComment, PrCommit, ReviewMeta, Side } from '@criever/shared';
import { UserError } from '../errors';
import type { Git } from '../git';
import type { LocalReviewStore } from '../localreview';
import type { Provider, PublishBody } from '../provider';

const initials = (name: string) => name.split(/\s+/).map(p => p[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';

function toBbComment(c: LocalComment): BbComment {
  const author = c.author === 'agent'
    ? { name: c.agentName ?? 'agent', initials: initials(c.agentName ?? 'agent'), isMe: false }
    : { name: 'you', initials: 'ME', isMe: true };
  return {
    id: c.id, parentId: c.parentId, author, createdOn: c.createdAt, body: c.body, resolved: c.resolved, deleted: false,
    inline: c.path == null ? null : { path: c.path, from: c.side === 'old' ? c.line : null, to: c.side === 'new' ? c.line : null },
  };
}

/** A review with no PR: any two git refs, diffed and commented on entirely through `.criever/review.json`. */
export class LocalProvider implements Provider {
  readonly kind = 'local' as const;
  constructor(private git: Git, private store: LocalReviewStore, private base: string, private head: string, private branch: string) {}

  private resolveHead(): Promise<string> {
    return this.git.run(['rev-parse', this.head]).then(r => r.stdout.trim());
  }

  async meta(): Promise<ReviewMeta> {
    const [baseHead, headHead] = await Promise.all([
      this.git.run(['rev-parse', this.base]).then(r => r.stdout.trim()),
      this.resolveHead(),
    ]);
    return {
      // A local review has no PR id; 0 is stable across calls, which is all "synthetic id" needs to mean here.
      id: 0, title: `local review · ${baseHead.slice(0, 7)}..${headHead.slice(0, 7)}`, url: null, author: 'you', description: null,
      sourceBranch: this.branch, sourceHead: headHead, remoteSourceHead: headHead, destinationBranch: this.base, destinationHead: baseHead,
    };
  }

  async listCommits(): Promise<PrCommit[]> {
    const r = await this.git.run(['log', '--date=iso-strict', '--format=%H%x1f%ad%x1f%s', `${this.base}..${this.head}`]);
    return r.stdout.split('\n').filter(Boolean).map(line => {
      const [hash, date, message] = line.split('\x1f');
      return { hash: hash!, date: date!, message: message! };
    });
  }

  async listComments(): Promise<BbComment[]> {
    await this.store.load();
    return this.store.review.comments.map(toBbComment);
  }

  /** Every local root comment already carries the exact commit it was anchored against — no inference needed. */
  async localAnchors(): Promise<Record<number, Anchor>> {
    await this.store.load();
    const anchors: Record<number, Anchor> = {};
    for (const c of this.store.review.comments) {
      if (c.parentId != null || c.path == null) continue; // replies and review-level comments aren't anchored
      anchors[c.id] = { path: c.path, line: c.line ?? 1, side: c.side, anchorCommit: c.anchorCommit, source: 'criever' };
    }
    return anchors;
  }

  async publishComment(b: PublishBody): Promise<number> {
    const draft = { path: b.path, line: b.line, side: b.side as Side, body: b.raw, author: 'me' as const, anchorCommit: await this.resolveHead() };
    if (b.parentId != null) {
      const c = await this.store.reply(b.parentId, draft);
      if (!c) throw new UserError(`Comment ${b.parentId} isn't a root comment in this local review.\nReplies can only be added to top-level comments.`);
      return c.id;
    }
    return (await this.store.add(draft)).id;
  }

  async resolveComment(commentId: number): Promise<void> {
    const ok = await this.store.resolve(commentId);
    if (!ok) throw new UserError(`Comment ${commentId} isn't a root comment in this local review, so it can't be resolved.`);
  }
}
