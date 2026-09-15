import type { Anchor, BbComment, PrCommit, ReviewMeta, Side } from '@criever/shared';
import type { BitbucketClient, RawPr } from './bitbucket';

export interface PublishBody { raw: string; path: string; line: number; side: Side; parentId?: number }

export interface Provider {
  readonly kind: 'bitbucket' | 'local';
  /** Human-facing description of where this review comes from, for the UI header. */
  meta(): Promise<ReviewMeta>;
  listComments(): Promise<BbComment[]>;
  listCommits(): Promise<PrCommit[]>;
  publishComment(b: PublishBody): Promise<number>;
  resolveComment(commentId: number): Promise<void>;
  /**
   * Anchors already known exactly (never inferred), keyed by comment id. Only a local review's
   * comments carry their own `anchorCommit`, so only `LocalProvider` implements this; the server
   * seeds `buildThreads`'s anchor map with it so a local comment is never guessed at.
   */
  localAnchors?(): Promise<Record<number, Anchor>>;
}

export function rawPrToMeta(pr: RawPr): ReviewMeta {
  return {
    id: pr.id, title: pr.title, url: pr.links.html.href, author: pr.author.display_name,
    description: pr.description?.trim() || null,
    sourceBranch: pr.source.branch.name, sourceHead: pr.source.commit.hash, remoteSourceHead: pr.source.commit.hash,
    destinationBranch: pr.destination.branch.name, destinationHead: pr.destination.commit.hash,
  };
}

export class BitbucketProvider implements Provider {
  readonly kind = 'bitbucket' as const;
  constructor(private bb: BitbucketClient, private ws: string, private repo: string, private prId: number) {}
  async meta(): Promise<ReviewMeta> { return rawPrToMeta(await this.bb.getPr(this.ws, this.repo, this.prId)); }
  listComments(): Promise<BbComment[]> { return this.bb.listComments(this.ws, this.repo, this.prId); }
  listCommits(): Promise<PrCommit[]> { return this.bb.listCommits(this.ws, this.repo, this.prId); }
  publishComment(b: PublishBody): Promise<number> { return this.bb.publishComment(this.ws, this.repo, this.prId, b); }
  resolveComment(commentId: number): Promise<void> { return this.bb.resolveComment(this.ws, this.repo, this.prId, commentId); }
}
