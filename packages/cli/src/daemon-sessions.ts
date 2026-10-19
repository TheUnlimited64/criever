import { mkdtemp, rmdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { ReviewMeta, WorkspaceProject, WorkspaceSession } from '@criever/shared';
import { Git } from './git';
import { GitHubClient } from './github';
import { BitbucketClient, fullCommitId } from './bitbucket';
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

  async function repositoryReady(source: Git) {
    for (const operation of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG', 'sequencer', 'index.lock', 'HEAD.lock']) {
      const path = (await source.run(['rev-parse', '--git-path', operation])).stdout.trim();
      if (existsSync(resolve(source.root, path))) throw new DaemonError('Repository has an ongoing Git operation; finish it before checkout', 409);
    }
    if ((await source.run(['status', '--porcelain', '--untracked-files=all'])).stdout.trim()) {
      throw new DaemonError('Repository must have no tracked or untracked changes before checkout', 409);
    }
  }

  async function removeTemporary(source: Git, path: string) {
    const git = new Git(path);
    const status = await git.run(['status', '--porcelain', '--untracked-files=all', '--ignored=matching'], { allowFail: true });
    if (status.code === 0 && status.stdout.trim()) {
      opts.log(`Preserved modified review worktree ${path}`);
      return;
    }
    const result = await source.run(['worktree', 'remove', path], { allowFail: true });
    if (result.code !== 0) {
      // A failed add may leave an unregistered empty directory. Never recursively
      // remove it: Git or an editor may have written files after the failure.
      try { await rmdir(path); }
      catch (e) { opts.log(`Preserved review worktree ${path}: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }

  async function checkout(p: WorkspaceProject, prId: number, confirmed: unknown, target: unknown = 'temporary'): Promise<WorkspaceSession> {
    if (confirmed !== true) throw new DaemonError('Explicit confirmation required: confirmed must be true', 400);
    if (target !== 'temporary' && target !== 'repository') throw new DaemonError('target must be temporary or repository', 400);
    const displayed = p.pullRequests.find(pr => pr.id === prId);
    if (!displayed) throw new DaemonError('Pull request not found', 404);
    const source = await Git.open(p.path);
    if (target === 'repository') await repositoryReady(source);
    const c = await opts.client(p);
    let displayedHead = displayed.sourceHead;
    const openMeta = async (): Promise<ReviewMeta> => {
      if (c instanceof GitHubClient) return c.getOpenPr(p.owner, p.repo, prId);
      const raw = await c.getPr(p.owner, p.repo, prId);
      if (raw.state !== 'OPEN') throw new DaemonError('Pull request is no longer open', 409);
      displayedHead = await c.resolveRevision(p.owner, p.repo, { ...raw.source, commit: { hash: displayed.sourceHead } });
      return rawPrToMeta(await c.resolvePr(p.owner, p.repo, raw));
    };
    const meta = await openMeta();
    if (![meta.sourceHead, meta.destinationHead].every(fullCommitId)) throw new DaemonError('Provider returned unsafe commit IDs', 409);
    if (meta.sourceHead !== displayedHead) throw new DaemonError('Pull request head changed; refresh before preparing checkout', 409);
    const { name: remote } = await source.resolveRemote();
    // GitHub pull refs support forks; Bitbucket accepts the exact advertised commit ID.
    await source.fetch(remote, [p.provider === 'github' ? `refs/pull/${prId}/head` : meta.sourceHead]);
    const fetched = (await source.run(['rev-parse', 'FETCH_HEAD'])).stdout.trim();
    if (fetched !== meta.sourceHead) throw new DaemonError('Fetched pull request head changed; refresh before preparing checkout', 409);
    await source.fetch(remote, [meta.destinationHead]);
    if ((await source.run(['rev-parse', 'FETCH_HEAD^{commit}'])).stdout.trim() !== meta.destinationHead) {
      throw new DaemonError('Fetched destination changed; refresh before preparing checkout', 409);
    }
    const id = crypto.randomUUID();
    const provider = c instanceof GitHubClient ? new GitHubProvider(c, p.owner, p.repo, prId) : new BitbucketProvider(c, p.owner, p.repo, prId);
    const [comments, commits] = await Promise.all([provider.listComments(), provider.listCommits()]);
    const stateFile = StateStore.path(p.provider === 'github' ? join(opts.stateDir, 'github') : opts.stateDir, p.owner, p.repo, prId);
    let store = stores.get(stateFile);
    if (!store) { store = new StateStore(stateFile); await store.load(); stores.set(stateFile, store); }
    const mergeBase = await source.mergeBase(meta.destinationHead, meta.sourceHead);
    const latest = await openMeta();
    if (latest.sourceHead !== meta.sourceHead || latest.destinationHead !== meta.destinationHead) throw new DaemonError('Pull request changed during checkout; refresh and try again', 409);
    const worktree = target === 'temporary' ? await mkdtemp(join(tmpdir(), 'criever-review-')) : source.root;
    if (target === 'temporary') {
      try { await source.run(['worktree', 'add', '--detach', worktree, meta.sourceHead]); }
      catch (e) { await removeTemporary(source, worktree); throw e; }
    } else {
      await repositoryReady(source);
      const result = await source.run(['checkout', '--detach', '--no-overwrite-ignore', meta.sourceHead], { allowFail: true });
      if (result.code !== 0) throw new DaemonError(`Repository checkout refused: ${result.stderr.trim()}`, 409);
      for (const [oldId, old] of sessions) {
        if (old.info.checkoutTarget !== 'repository' || old.source.root !== source.root) continue;
        sessions.delete(oldId);
        try { await old.vscode.stop(); }
        catch (e) { opts.log(`Could not stop replaced review editor: ${e instanceof Error ? e.message : String(e)}`); }
      }
    }
    const vscode = createVscode({ repoRoot: worktree, cacheDir: opts.cacheDir, dataDir: join(opts.cacheDir, 'vscode-sessions', id), log: opts.log });
    const deps: ServerDeps = { git: new Git(worktree), store, provider, ws: p.owner, repo: p.repo, meta, mergeBase, comments, commits, remote, staticDir: null, vscode };
    const info: WorkspaceSession = { id, projectId: p.id, prId, sourceHead: meta.sourceHead, title: meta.title, url: `/review/${id}/`, checkoutTarget: target, checkoutPath: worktree };
    sessions.set(id, { info, deps, handler: createHandler(deps), source, checkout: worktree, vscode });
    return info;
  }

  async function stop() {
    for (const s of sessions.values()) {
      await s.vscode.stop();
      if (s.info.checkoutTarget === 'temporary') await removeTemporary(s.source, s.checkout);
    }
    sessions.clear();
  }

  return { sessions, checkout, stop };
}
