import type { BbComment, PrCommit, ReviewMeta } from '@criever/shared';
import { GitHubClient } from '../github';
import type { Provider, PublishBody } from '../provider';

export class GitHubProvider implements Provider {
  readonly kind = 'github' as const;
  constructor(private github: GitHubClient, private owner: string, private repo: string, private prId: number) {}
  meta(): Promise<ReviewMeta> { return this.github.getPr(this.owner, this.repo, this.prId); }
  listComments(): Promise<BbComment[]> { return this.github.listComments(this.owner, this.repo, this.prId); }
  listCommits(): Promise<PrCommit[]> { return this.github.listCommits(this.owner, this.repo, this.prId); }
  publishComment(body: PublishBody): Promise<number> { return this.github.publishComment(this.owner, this.repo, this.prId, body); }
  publishComments(bodies: PublishBody[]): Promise<number[]> { return this.github.publishComments(this.owner, this.repo, this.prId, bodies); }
  resolveComment(commentId: number): Promise<void> { return this.github.resolveComment(this.owner, this.repo, this.prId, commentId); }
}
