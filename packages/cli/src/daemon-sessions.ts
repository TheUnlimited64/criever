import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReviewMeta, WorkspaceProject, WorkspaceSession } from '@criever/shared';
import { Git } from './git';
import { GitHubClient } from './github';
import { BitbucketClient } from './bitbucket';
import { BitbucketProvider, rawPrToMeta } from './provider';
import { GitHubProvider } from './providers/github';
import { StateStore } from './state';
import { createHandler, type ServerDeps } from './server';
import { createVscode } from './vscode';
import { DaemonError } from './errors';

export function createSessions(opts: {
  stateDir: string; cacheDir: string; log: (s: string) => void;
  client: (project: WorkspaceProject) => Promise<GitHubClient | BitbucketClient>;
}) {
  const sessions = new Map<string, {
    info: WorkspaceSession; deps: ServerDeps; handler: ReturnType<typeof createHandler>;
    source: Git; checkout: string; vscode: ReturnType<typeof createVscode>;
  }>();
  const stores = new Map<string, StateStore>();

  async function checkout(p: WorkspaceProject, prId: number, confirmed: unknown): Promise<WorkspaceSession> {
    if (confirmed !== true) throw new DaemonError('Explicit confirmation required: confirmed must be true', 400);
    const displayed = p.pullRequests.find(pr => pr.id === prId);
    if (!displayed) throw new DaemonError('Pull request not found', 404);
    const source = await Git.open(p.path);
    const c = await opts.client(p);
    const openMeta = async (): Promise<ReviewMeta> => {
      if (c instanceof GitHubClient) return c.getOpenPr(p.owner, p.repo, prId);
      const raw = await c.getPr(p.owner, p.repo, prId);
      if (raw.state !== 'OPEN') throw new DaemonError('Pull request is no longer open', 409);
      return rawPrToMeta(raw);
    };
    const meta = await openMeta();
    if (meta.sourceHead !== displayed.sourceHead) throw new DaemonError('Pull request head changed; refresh before preparing checkout', 409);
    if (![meta.sourceHead, meta.destinationHead].every(h => /^[0-9a-f]{40,64}$/i.test(h))) throw new DaemonError('Provider returned unsafe commit IDs', 409);
    const { name: remote } = await source.resolveRemote();
    // GitHub pull refs support forks; Bitbucket accepts the exact advertised commit ID.
    await source.fetch(remote, [p.provider === 'github' ? `refs/pull/${prId}/head` : meta.sourceHead]);
    const fetched = (await source.run(['rev-parse', 'FETCH_HEAD'])).stdout.trim();
    if (fetched !== meta.sourceHead) throw new DaemonError('Fetched pull request head changed; refresh before preparing checkout', 409);
    await source.fetch(remote, [meta.destinationHead]);
    const latest = await openMeta();
    if (latest.sourceHead !== meta.sourceHead || latest.destinationHead !== meta.destinationHead) throw new DaemonError('Pull request changed during checkout; refresh and try again', 409);
    const id = crypto.randomUUID();
    const worktree = join(opts.stateDir, 'worktrees', id);
    await mkdir(join(opts.stateDir, 'worktrees'), { recursive: true });
    const provider = c instanceof GitHubClient ? new GitHubProvider(c, p.owner, p.repo, prId) : new BitbucketProvider(c, p.owner, p.repo, prId);
    const [comments, commits] = await Promise.all([provider.listComments(), provider.listCommits()]);
    const stateFile = StateStore.path(p.provider === 'github' ? join(opts.stateDir, 'github') : opts.stateDir, p.owner, p.repo, prId);
    let store = stores.get(stateFile);
    if (!store) { store = new StateStore(stateFile); await store.load(); stores.set(stateFile, store); }
    const mergeBase = await source.mergeBase(meta.destinationHead, meta.sourceHead);
    await source.run(['worktree', 'add', '--detach', worktree, meta.sourceHead]);
    const vscode = createVscode({ repoRoot: worktree, cacheDir: opts.cacheDir, dataDir: join(opts.cacheDir, 'vscode-sessions', id), log: opts.log });
    const deps: ServerDeps = { git: new Git(worktree), store, provider, ws: p.owner, repo: p.repo, meta, mergeBase, comments, commits, remote, staticDir: null, vscode };
    const info: WorkspaceSession = { id, projectId: p.id, prId, sourceHead: meta.sourceHead, title: meta.title, url: `/review/${id}/` };
    sessions.set(id, { info, deps, handler: createHandler(deps), source, checkout: worktree, vscode });
    return info;
  }

  async function stop() {
    for (const s of sessions.values()) {
      await s.vscode.stop();
      // Never force-remove a worktree: edits made during review must survive.
      if ((await s.deps.git.run(['status', '--porcelain', '--untracked-files=all', '--ignored=matching'])).stdout.trim()) {
        opts.log(`Preserved modified review worktree ${s.checkout}`);
        continue;
      }
      const result = await s.source.run(['worktree', 'remove', s.checkout], { allowFail: true });
      if (result.code !== 0) opts.log(`Preserved review worktree ${s.checkout}: ${result.stderr.trim()}`);
    }
    sessions.clear();
  }

  return { sessions, checkout, stop };
}
