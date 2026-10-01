import { basename } from 'node:path';
import { homedir } from 'node:os';
import type { WorkspaceProject, WorkspacePullRequest } from '@criever/shared';
import { defaultPaths, loadCredentials, loadGithubCredentials } from './config';
import { Git } from './git';
import { GitHubClient } from './github';
import { BitbucketClient, fullCommitId } from './bitbucket';
import { rawPrToMeta } from './provider';
import { parseRemote, remoteProvider } from './remote';
import { serveStatic } from './server';
import { DaemonError as ApiError, UserError } from './errors';
import { WorkspaceStore } from './daemon-state';
import { createSessions } from './daemon-sessions';
import { listProjectFolders, resolveProjectPath, suggestProjectFolders } from './project-folders';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
});
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nullableString = (v: unknown) => v === null || typeof v === 'string';

const status = (head: string, reviewed: string | null): WorkspacePullRequest['status'] =>
  reviewed === null ? 'unreviewed' : reviewed === head ? 'reviewed' : 'updated';

export async function createDaemon(opts: {
  env: Record<string, string | undefined>; cwd?: string; staticDir: string | null;
  log: (s: string) => void; fetch?: typeof fetch; pollIntervalMs?: number;
}): Promise<{ fetch: (req: Request) => Promise<Response>; stop: () => Promise<void> }> {
  const paths = defaultPaths(opts.env);
  const locations = { cwd: opts.cwd ?? process.cwd(), home: opts.env.HOME || opts.env.USERPROFILE || homedir() };
  const pollIntervalMs = opts.pollIntervalMs ?? 60_000;
  const workspace = await WorkspaceStore.open(paths.stateDir, pollIntervalMs);
  let stopped = false;
  let operations: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = operations.then(fn);
    operations = result.catch(() => {});
    return result;
  };
  // Bound every provider call, including injected fixture transports.
  const fetchFn: typeof fetch = Object.assign((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (![new URL(opts.env.BITBUCKET_API_BASE ?? 'https://api.bitbucket.org/2.0').origin, 'https://api.github.com'].includes(url.origin)) {
      throw new ApiError('Refusing to send provider credentials to an untrusted origin', 502);
    }
    const timeout = AbortSignal.timeout(15_000);
    const existing = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return (opts.fetch ?? fetch)(input, { ...init, signal: existing ? AbortSignal.any([existing, timeout]) : timeout });
  }, { preconnect: fetch.preconnect });
  const commitIds = new Map<string, Promise<string>>();
  async function client(p: WorkspaceProject) {
    return p.provider === 'github'
      ? new GitHubClient({ ...await loadGithubCredentials(opts.env, paths.configPath), fetch: fetchFn })
      : new BitbucketClient({ ...await loadCredentials(opts.env, paths.configPath), base: opts.env.BITBUCKET_API_BASE ?? 'https://api.bitbucket.org/2.0', fetch: fetchFn, commitIds });
  }
  async function refresh(p: WorkspaceProject): Promise<WorkspaceProject> {
    let next: WorkspaceProject;
    try {
      const c = await client(p);
      const reviewedHeads = new Map<number, string>();
      const rows = c instanceof GitHubClient ? await c.listOpenPrs(p.owner, p.repo)
        : await Promise.all((await c.listOpenPrs(p.owner, p.repo)).map(async ({ pr, assignedToMe }) => {
          const old = p.pullRequests.find(row => row.id === pr.id);
          if (old?.reviewedHead != null) {
            reviewedHeads.set(pr.id, await c.resolveRevision(p.owner, p.repo, { ...pr.source, commit: { hash: old.reviewedHead } }));
          }
          // Unreviewed rows need no commit-detail calls during polling.
          const sourceHead = old?.reviewedHead == null ? pr.source.commit.hash
            : await c.resolveRevision(p.owner, p.repo, pr.source);
          return { ...rawPrToMeta(pr), sourceHead, assignedToMe, draft: pr.draft ?? false, updatedAt: pr.updated_on ?? pr.created_on };
        }));
      next = { ...p, error: null, refreshedAt: new Date().toISOString(), pullRequests: rows.map(row => {
        const old = p.pullRequests.find(pr => pr.id === row.id);
        const reviewedHead = reviewedHeads.get(row.id) ?? old?.reviewedHead ?? null;
        return { ...row, url: row.url ?? '', reviewedHead, reviewedAt: old?.reviewedAt ?? null, status: status(row.sourceHead, reviewedHead) };
      }) };
    } catch (e) {
      next = { ...p, error: e instanceof Error ? e.message : String(e) };
      opts.log(`Refresh ${p.owner}/${p.repo}: ${next.error}`);
    }
    workspace.projects = workspace.projects.map(project => project.id === p.id ? next : project);
    await workspace.save();
    return next;
  }
  async function refreshAll() {
    for (const p of workspace.projects) await refresh(p);
    return workspace.snapshot();
  }
  const reviews = createSessions({ ...paths, log: opts.log, client });
  const { sessions, checkout } = reviews;
  const getProject = (id: string) => {
    const p = workspace.projects.find(p => p.id === id);
    if (!p) throw new ApiError('Project not found', 404);
    return p;
  };
  let periodic: Promise<unknown> | null = null;
  const timer = setInterval(() => {
    if (stopped || periodic) return;
    periodic = enqueue(refreshAll).catch(e => opts.log(`Workspace refresh failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => { periodic = null; });
  }, pollIntervalMs);
  timer.unref();
  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || (req.headers.has('host') && req.headers.get('host')?.toLowerCase() !== url.host.toLowerCase())) return json({ error: 'Untrusted Host' }, 403);
    if ((!['GET', 'HEAD', 'OPTIONS'].includes(req.method) || url.pathname === '/api/workspace/folders')
      && ((req.headers.has('origin') && req.headers.get('origin') !== url.origin)
        || req.headers.get('sec-fetch-site') === 'cross-site')) return json({ error: 'Cross-origin request rejected' }, 403);
    if (stopped) return json({ error: 'Daemon stopped' }, 503);
    try {
      const p = url.pathname;
      const sessionApi = /^\/api\/sessions\/([^/]+)\/(.*)$/.exec(p);
      if (sessionApi) {
        const s = sessions.get(sessionApi[1] ?? '');
        if (!s) return json({ error: 'Review session expired or not found' }, 404);
        url.pathname = `/api/${sessionApi[2]}`;
        return s.handler(new Request(url, req));
      }
      const sessionInfo = /^\/api\/workspace\/sessions\/([^/]+)$/.exec(p);
      if (sessionInfo && req.method === 'GET') {
        const s = sessions.get(sessionInfo[1] ?? '');
        return s ? json({ ...s.info, sourceHead: s.deps.meta.sourceHead }) : json({ error: 'Review session expired or not found' }, 404);
      }
      if (p === '/api/workspace' && req.method === 'GET') return json(workspace.snapshot());
      if (p === '/api/workspace/folders' && req.method === 'GET') {
        const folders = url.searchParams.get('autocomplete') === 'true' ? suggestProjectFolders : listProjectFolders;
        return json(await folders(url.searchParams.get('path') ?? '~', locations));
      }
      if (!p.startsWith('/api/')) return serveStatic(opts.staticDir, decodeURIComponent(p));
      return await enqueue(async () => {
        if (stopped) throw new ApiError('Daemon stopped', 503);
        if (p === '/api/workspace/refresh' && req.method === 'POST') return json(await refreshAll());
        if (p === '/api/workspace/projects' && req.method === 'POST') {
          const b: unknown = await req.json();
          if (!object(b) || typeof b.path !== 'string' || !b.path.trim()) throw new ApiError('path must be a nonempty string', 400);
          const git = await Git.open(resolveProjectPath(b.path, locations));
          const old = workspace.projects.find(p => p.path === git.root);
          if (old) return json(await refresh(old));
          const { url: remoteUrl } = await git.resolveRemote();
          const { workspace: owner, repo } = parseRemote(remoteUrl);
          const project: WorkspaceProject = { id: crypto.randomUUID(), name: basename(git.root), path: git.root, provider: remoteProvider(remoteUrl), owner, repo, pullRequests: [], refreshedAt: null, error: null };
          workspace.projects.push(project);
          return json(await refresh(project));
        }
        const route = /^\/api\/workspace\/projects\/([^/]+)(?:\/(refresh|prs\/(\d+)\/(reviewed|checkout)))?$/.exec(p);
        if (!route) return json({ error: 'not found' }, 404);
        const project = getProject(route[1] ?? '');
        if (!route[2] && req.method === 'DELETE') {
          workspace.projects = workspace.projects.filter(p => p.id !== project.id);
          await workspace.save();
          return json({ ok: true });
        }
        if (req.method !== 'POST') return json({ error: 'not found' }, 404);
        if (route[2] === 'refresh') return json(await refresh(project));
        const b: unknown = await req.json();
        if (!object(b)) throw new ApiError('JSON object required', 400);
        const prId = Number(route[3]);
        if (route[4] === 'checkout') return json(await checkout(project, prId, b.confirmed, b.target));
        if (route[4] === 'reviewed') {
          if (!nullableString(b.sourceHead) || b.sourceHead === undefined) throw new ApiError('sourceHead must be a string or null', 400);
          const pr = project.pullRequests.find(pr => pr.id === prId);
          if (!pr) throw new ApiError('Pull request not found', 404);
          let reviewedHead = b.sourceHead;
          let sourceHead = pr.sourceHead;
          if (reviewedHead !== null && project.provider === 'bitbucket') {
            const c = await client(project);
            if (c instanceof BitbucketClient) {
              const raw = await c.getPr(project.owner, project.repo, prId);
              sourceHead = await c.resolveRevision(project.owner, project.repo, { ...raw.source, commit: { hash: pr.sourceHead } });
              if (reviewedHead === pr.sourceHead) reviewedHead = sourceHead;
            }
          }
          if (reviewedHead !== null && (!fullCommitId(reviewedHead) || (reviewedHead !== sourceHead
            && ![...sessions.values()].some(s => s.info.projectId === project.id && s.info.prId === prId
              && (s.info.sourceHead === reviewedHead || s.deps.meta.sourceHead === reviewedHead))))) throw new ApiError('Unknown review revision', 409);
          const next: WorkspaceProject = { ...project, pullRequests: project.pullRequests.map(row => row.id === prId
            ? { ...row, sourceHead, reviewedHead, reviewedAt: reviewedHead === null ? null : new Date().toISOString(), status: status(sourceHead, reviewedHead) } : row) };
          workspace.projects = workspace.projects.map(row => row.id === project.id ? next : row);
          await workspace.save();
          return json(next);
        }
        return json({ error: 'not found' }, 404);
      });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, e instanceof ApiError ? e.status : e instanceof SyntaxError || e instanceof UserError ? 400 : 500);
    }
  }
  let stopping: Promise<void> | null = null;
  async function stop() {
    stopped = true;
    clearInterval(timer);
    await operations;
    try { await reviews.stop(); } finally { await workspace.release(); }
  }
  return {
    fetch: handle,
    stop: () => (stopping ??= stop()),
  };
}
