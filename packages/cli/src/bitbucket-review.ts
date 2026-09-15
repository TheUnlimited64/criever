import type { PrCommit, ReviewMeta } from '@criever/shared';
import type { Git } from './git';

export interface BitbucketReviewSnapshot {
  readonly meta: ReviewMeta;
  readonly commits: PrCommit[];
}

function parseCommitLine(line: string): PrCommit {
  const [hash, date, message] = line.split('\x1f');
  if (hash === undefined || date === undefined || message === undefined) {
    throw new Error(`git log returned malformed commit metadata: ${line}`);
  }
  return { hash, date, message, localOnly: true };
}

async function localCommits(git: Git, remoteHead: string, localHead: string): Promise<PrCommit[]> {
  const result = await git.run(['log', '--date=iso-strict', '--format=%H%x1f%ad%x1f%s', `${remoteHead}..${localHead}`]);
  return result.stdout.split('\n').filter(Boolean).map(parseCommitLine);
}

export async function snapshotBitbucketReview(git: Git, meta: ReviewMeta, remoteCommits: readonly PrCommit[]): Promise<BitbucketReviewSnapshot> {
  const remoteSourceHead = meta.remoteSourceHead ?? meta.sourceHead;
  const localHead = (await git.run(['rev-parse', 'HEAD'])).stdout.trim();
  const localDescendant = localHead !== remoteSourceHead && await git.isAncestor(remoteSourceHead, localHead);
  const sourceHead = localDescendant ? localHead : remoteSourceHead;
  const localOnly = sourceHead === remoteSourceHead ? [] : await localCommits(git, remoteSourceHead, sourceHead);
  const remoteBacked = remoteCommits.map(commit => ({ ...commit, localOnly: false }));
  return {
    meta: { ...meta, sourceHead, remoteSourceHead },
    commits: [...localOnly, ...remoteBacked],
  };
}
