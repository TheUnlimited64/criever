import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildFixtureRepo } from '../fixtures/repo';
import { createDaemon } from '../src/daemon';
import { Git } from '../src/git';
import { StateStore } from '../src/state';
import * as vscode from '../src/vscode';
import type { WorkspaceProject, WorkspaceSession, WorkspaceSnapshot } from '@criever/shared';

const cleanups: (() => Promise<unknown>)[] = [];
const temporaryPaths = new Set<string>();
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const path of temporaryPaths) await rm(path, { recursive: true, force: true });
  temporaryPaths.clear();
  vi.restoreAllMocks();
});
const connection = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };

async function setup(provider: 'github' | 'bitbucket' = 'bitbucket', pollIntervalMs = 60_000, shortHashes = false) {
  const root = await mkdtemp(join(tmpdir(), 'daemon-test-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const repo = await buildFixtureRepo(join(root, 'repo'));
  const git = new Git(repo.root);
  if (provider === 'github') {
    const bare = join(root, 'github.com', 'sample-workspace', 'review-fixture.git');
    await git.run(['clone', '--bare', repo.root, bare]);
    await new Git(bare).run(['update-ref', 'refs/pull/241/head', repo.c2]);
    await git.run(['remote', 'set-url', 'origin', bare]);
  }
  let head = repo.c2;
  let failure = false;
  let closed = false;
  let block: Promise<void> | null = null;
  let entered: (() => void) | null = null;
  let listCalls = 0;
  let publication: Promise<void> | null = null;
  let publicationStarted: (() => void) | null = null;
  let publishCalls = 0;
  let sourceId: string | null = null;
  let destinationId: string | null = null;
  let detail: { hash: string; status: number } | null = null;
  let commentsGate: Promise<void> | null = null;
  let commentsEntered: (() => void) | null = null;
  const logs: string[] = [];
  const calls: { method: string; path: string }[] = [];
  const stub = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    async fetch(req): Promise<Response> {
      const u = new URL(req.url); const p = u.pathname;
      calls.push({ method: req.method, path: p });
      if (failure) return Response.json({ error: 'offline' }, { status: 503 });
      if (p === '/user/teams') return Response.json([{ id: 9 }]);
      if (p === '/user' || p === '/2.0/user') return Response.json({ login: 'alex', uuid: '{me}' });
      if (p === '/graphql') return Response.json({ data: { repository: { pullRequest: { reviewThreads: connection } } } });
      if (p.endsWith('/comments') && req.method === 'POST') {
        const id = 900 + ++publishCalls;
        publicationStarted?.();
        if (publication) await publication;
        return Response.json({ id });
      }
      if (p.endsWith('/comments')) {
        commentsEntered?.();
        if (commentsGate) await commentsGate;
        return Response.json(provider === 'github' ? [] : { values: [] });
      }
      if (p.endsWith('/commits')) return Response.json(provider === 'github' ? [] : { values: [] });
      const commit = /\/commit\/([0-9a-f]+)$/.exec(p);
      if (commit) {
        if (detail) return Response.json({ hash: detail.hash }, { status: detail.status });
        const matches = [repo.main, repo.c1, repo.c2, repo.c3].filter(hash => hash.startsWith(commit[1] ?? ''));
        return matches.length === 1 ? Response.json({ hash: matches[0] }) : Response.json({ error: 'unresolved commit' }, { status: 404 });
      }
      const bb = {
        id: 241, state: closed ? 'MERGED' : 'OPEN', title: 'Review me', created_on: '2026-09-01', updated_on: '2026-09-02',
        author: { uuid: '{other}', display_name: 'Other' }, reviewers: [{ uuid: '{me}' }],
        links: { html: { href: 'https://bitbucket.org/o/r/pull-requests/241' } },
        source: { branch: { name: 'fork/branch-not-local' }, commit: { hash: sourceId ?? (shortHashes ? head.slice(0, 12) : head) },
          repository: { full_name: 'fork-owner/source-repo' } },
        destination: { branch: { name: 'main' }, commit: { hash: destinationId ?? (shortHashes ? repo.main.slice(0, 12) : repo.main) },
          repository: { full_name: 'sample-workspace/review-fixture' } },
      };
      const gh = {
        number: 241, state: closed ? 'closed' : 'open', title: 'Review me', created_at: '2026-09-01', updated_at: '2026-09-02',
        user: { login: 'other' }, html_url: 'https://github.com/o/r/pull/241', body: '',
        requested_reviewers: [{ login: 'Alex' }], requested_teams: [],
        head: { ref: 'fork/branch-not-local', sha: head }, base: { ref: 'main', sha: repo.main },
      };
      if (/\/24[12]$/.test(p)) return Response.json(provider === 'github'
        ? { ...gh, number: p.endsWith('/242') ? 242 : 241 }
        : { ...bb, id: p.endsWith('/242') ? 242 : 241 });
      if (p.endsWith('/pulls') || p.endsWith('/pullrequests')) {
        listCalls++;
        entered?.();
        if (block) await block;
        if (u.searchParams.has('page')) {
          return Response.json(provider === 'github'
            ? [{ ...gh, number: 242, requested_reviewers: [], requested_teams: [{ id: 9 }] }]
            : { values: [{ ...bb, id: 242, reviewers: [] }] });
        }
        const next = provider === 'github'
          ? 'https://api.github.com/repos/sample-workspace/review-fixture/pulls?page=2'
          : `${stub.url}2.0/repositories/sample-workspace/review-fixture/pullrequests?page=2`;
        return provider === 'github' ? Response.json([gh], { headers: { Link: `<${next}>; rel="next"` } })
          : Response.json({ values: [bb], next });
      }
      return Response.json({ error: p }, { status: 404 });
    },
  });
  cleanups.push(async () => stub.stop(true));
  const injected: typeof fetch = Object.assign((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const u = new URL(input instanceof Request ? input.url : String(input));
    return fetch(provider === 'github' ? new URL(u.pathname + u.search, stub.url) : input, init);
  }, { preconnect: fetch.preconnect });
  const opts = {
    env: { HOME: root, CRIEVER_STATE_DIR: join(root, 'state'), CRIEVER_CACHE_DIR: join(root, 'cache'), BITBUCKET_API_BASE: `${stub.url}2.0`,
      ATLASSIAN_USER_EMAIL: 'me', ATLASSIAN_API_TOKEN: 'token', GITHUB_TOKEN: 'token' },
    cwd: root, staticDir: null, log: (message: string) => { logs.push(message); }, fetch: injected, pollIntervalMs,
  };
  let daemon = await createDaemon(opts);
  cleanups.push(() => daemon.stop());
  const call = async (method: string, path: string, body?: unknown, headers?: HeadersInit) => {
    const response = await daemon.fetch(new Request('http://127.0.0.1:4917' + path, {
      method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers,
    }));
    if (path.endsWith('/checkout') && response.ok) {
      const session: WorkspaceSession = await response.clone().json();
      if (session.checkoutTarget === 'temporary') temporaryPaths.add(session.checkoutPath);
    }
    return response;
  };
  const add = async (): Promise<WorkspaceProject> => {
    const response = await call('POST', '/api/workspace/projects', { path: repo.root });
    expect(response.status).toBe(200);
    return response.json();
  };
  return {
    root, repo, git, opts, call, add, calls, logs, setFailure: (v: boolean) => { failure = v; },
    setIds: (source: string | null, destination: string | null = null) => { sourceId = source; destinationId = destination; },
    setDetail: (hash: string, status = 200) => { detail = { hash, status }; },
    pauseComments: () => {
      let release = () => {};
      commentsGate = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<void>(resolve => { commentsEntered = resolve; });
      return { started, release: () => { commentsGate = null; release(); } };
    },
    closePr: () => { closed = true; }, advance: async () => {
      head = repo.c3;
      if (provider === 'github') await new Git(join(root, 'github.com', 'sample-workspace', 'review-fixture.git')).run(['update-ref', 'refs/pull/241/head', head]);
    },
    restart: async () => { await daemon.stop(); daemon = await createDaemon(opts); },
    stop: () => daemon.stop(),
    pauseList: () => {
      let release = () => {};
      block = new Promise<void>(r => { release = r; });
      const started = new Promise<void>(r => { entered = r; });
      return { started, release: () => { block = null; release(); } };
    },
    listCalls: () => listCalls,
    pausePublish: () => {
      let release = () => {};
      publication = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<void>(resolve => { publicationStarted = resolve; });
      return { started, release: () => { publication = null; release(); } };
    },
    publishCalls: () => publishCalls,
  };
}

describe('daemon workspace integration', () => {
  it('checks out abbreviated Bitbucket source and destination commits as canonical revisions', async () => {
    const f = await setup('bitbucket', 60_000, true);
    const p = await f.add();
    expect(f.calls.filter(call => call.path.includes('/commit/'))).toEqual([]);
    const prefix = `/api/workspace/projects/${p.id}/prs/241`;
    const response = await f.call('POST', `${prefix}/checkout`, { confirmed: true });
    expect(response.status, await response.clone().text()).toBe(200);
    const session: WorkspaceSession = await response.json();
    expect(session.sourceHead).toBe(f.repo.c2);
    const api = `/api/sessions/${session.id}`;
    expect(await (await f.call('GET', `${api}/pr`)).json()).toMatchObject({ sourceHead: f.repo.c2, destinationHead: f.repo.main });
    expect((await f.call('POST', `${api}/refresh`)).status).toBe(200);
    expect((await f.call('POST', `${prefix}/reviewed`, { sourceHead: session.sourceHead })).status).toBe(200);
    const refreshed: WorkspaceProject = await (await f.call('POST', `/api/workspace/projects/${p.id}/refresh`)).json();
    expect(refreshed.pullRequests[0]).toMatchObject({ reviewedHead: f.repo.c2, status: 'reviewed' });
    expect(f.calls.filter(call => call.path.includes('/commit/')).map(call => call.path)).toEqual([
      `/2.0/repositories/fork-owner/source-repo/commit/${f.repo.c2.slice(0, 12)}`,
      `/2.0/repositories/sample-workspace/review-fixture/commit/${f.repo.main.slice(0, 12)}`,
    ]);
    await f.advance();
    const updated: WorkspaceProject = await (await f.call('POST', `/api/workspace/projects/${p.id}/refresh`)).json();
    expect(updated.pullRequests[0]?.status).toBe('updated');
    expect((await f.call('POST', `${api}/refresh`)).status).toBe(200);
    expect(await (await f.call('GET', `/api/workspace/sessions/${session.id}`)).json()).toMatchObject({ sourceHead: f.repo.c3 });
  });
  it('serves folder navigation from the daemon home and reports invalid locations', async () => {
    const f = await setup();
    const response = await f.call('GET', '/api/workspace/folders');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ path: f.root, folders: expect.arrayContaining([{ name: 'repo', path: f.repo.root }]) });
    expect((await f.call('GET', '/api/workspace/folders?path=~/missing')).status).toBe(404);
    expect((await f.call('GET', '/api/workspace/folders', undefined, { host: 'evil.example' })).status).toBe(403);
    expect((await f.call('GET', '/api/workspace/folders', undefined, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await f.call('GET', '/api/workspace/folders', undefined, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });
  it('adds a repository through home shorthand and deduplicates its absolute path', async () => {
    const f = await setup();
    const added = await f.call('POST', '/api/workspace/projects', { path: '~/repo' });
    expect(added.status, await added.clone().text()).toBe(200);
    const project: WorkspaceProject = await added.json();
    expect(project.path).toBe(f.repo.root);
    expect((await f.add()).id).toBe(project.id);
  });
  it.each(['github', 'bitbucket'] as const)('paginates %s assignments, persists review heads and preserves failed caches', async provider => {
    const f = await setup(provider);
    const p = await f.add();
    expect(p.pullRequests.map(pr => [pr.id, pr.assignedToMe])).toEqual([[241, true], [242, provider === 'github']]);
    const prefix = `/api/workspace/projects/${p.id}`;
    expect((await f.call('POST', `${prefix}/prs/241/reviewed`, { sourceHead: 'unseen' })).status).toBe(409);
    await f.call('POST', `${prefix}/prs/241/reviewed`, { sourceHead: f.repo.c2 });
    await f.restart();
    const persisted: WorkspaceSnapshot = await (await f.call('GET', '/api/workspace')).json();
    expect(persisted.projects[0]?.pullRequests[0]?.status).toBe('reviewed');
    await f.advance();
    const next: WorkspaceProject = await (await f.call('POST', `${prefix}/refresh`)).json();
    expect(next.pullRequests[0]).toMatchObject({ reviewedHead: f.repo.c2, sourceHead: f.repo.c3, status: 'updated' });
    f.setFailure(true);
    const failed: WorkspaceProject = await (await f.call('POST', `${prefix}/refresh`)).json();
    expect(failed.pullRequests).toEqual(next.pullRequests);
    expect(failed.error).toContain('503');
    expect(f.calls.filter(c => c.method === 'POST')).toEqual([]);
    expect((await f.call('DELETE', prefix)).status).toBe(200);
    expect((await f.call('GET', '/api/workspace').then(r => r.json())).projects).toEqual([]);
  });

  it.each(['github', 'bitbucket'] as const)('prepares isolated %s fork revisions and delegates session API including publish', async provider => {
    const f = await setup(provider);
    const p = await f.add(); const prefix = `/api/workspace/projects/${p.id}/prs/241`;
    expect((await f.call('POST', `${prefix}/checkout`, {})).status).toBe(400);
    await writeFile(join(f.repo.root, 'untracked.txt'), 'keep me');
    await writeFile(join(f.repo.root, 'package.json'), 'dirty tracked file');
    const originalStatus = (await f.git.run(['status', '--porcelain', '--untracked-files=all'])).stdout;
    const legacy = new StateStore(StateStore.path(provider === 'github' ? join(f.root, 'state/github') : join(f.root, 'state'), p.owner, p.repo, 241));
    await legacy.load();
    const existing = await legacy.addDraft({ path: 'package.json', line: 2, side: 'new', body: 'existing draft', anchorCommit: f.repo.c2 });
    const response = await f.call('POST', `${prefix}/checkout`, { confirmed: true });
    expect(response.status, await response.clone().text()).toBe(200);
    const session: WorkspaceSession = await response.json();
    expect(session.url).toBe(`/review/${session.id}/`);
    expect((await f.git.run(['rev-parse', 'HEAD'])).stdout.trim()).toBe(f.repo.c3);
    expect((await f.git.run(['status', '--porcelain', '--untracked-files=all'])).stdout).toBe(originalStatus);
    expect(await readFile(join(f.repo.root, 'untracked.txt'), 'utf8')).toBe('keep me');
    expect(await readFile(join(f.repo.root, 'package.json'), 'utf8')).toBe('dirty tracked file');
    expect(session.checkoutTarget).toBe('temporary');
    expect(session.checkoutPath.startsWith(join(tmpdir(), 'criever-review-'))).toBe(true);
    const worktree = new Git(session.checkoutPath);
    expect((await worktree.run(['rev-parse', 'HEAD'])).stdout.trim()).toBe(f.repo.c2);
    const api = `/api/sessions/${session.id}`;
    expect(await (await f.call('GET', `${api}/pr`)).json()).toMatchObject({ id: 241, sourceHead: f.repo.c2 });
    expect((await f.call('GET', `${api}/files`)).status).toBe(200);
    expect((await (await f.call('GET', `${api}/comments`)).json()).drafts).toMatchObject([{ id: existing.id, body: 'existing draft' }]);
    await f.call('DELETE', `${api}/drafts/${existing.id}`);
    await f.call('POST', `${api}/drafts`, { path: 'package.json', side: 'new', line: 2, body: 'hello', parentId: provider === 'github' ? 999 : undefined });
    const stream = await f.call('POST', `${api}/publish`);
    expect(stream.headers.get('content-type')).toContain('ndjson');
    expect((await stream.text()).trim()).toContain('"ok":' + (provider === 'bitbucket'));
    await f.advance();
    await f.call('POST', `/api/workspace/projects/${p.id}/refresh`);
    expect((await f.call('POST', `${prefix}/reviewed`, { sourceHead: session.sourceHead })).status).toBe(200);
    f.setFailure(true);
    expect((await f.call('POST', `${api}/refresh`)).status).toBe(500);
    expect(await (await f.call('GET', `/api/workspace/sessions/${session.id}`)).json()).toMatchObject({ sourceHead: f.repo.c2 });
    f.setFailure(false);
    expect((await f.call('POST', `${api}/refresh`)).status).toBe(200);
    expect(await (await f.call('GET', `/api/workspace/sessions/${session.id}`)).json()).toMatchObject({ sourceHead: f.repo.c3 });
    await writeFile(join(worktree.root, 'untracked-review.txt'), 'preserve session edits');
    await f.restart();
    expect(await readFile(join(worktree.root, 'untracked-review.txt'), 'utf8')).toBe('preserve session edits');
    expect((await f.call('GET', `${api}/pr`)).status).toBe(404);
  });

  it('publishes a shared draft only once when two sessions publish concurrently', async () => {
    const f = await setup('bitbucket', 60_000, true); const p = await f.add();
    const path = `/api/workspace/projects/${p.id}/prs/241/checkout`;
    const first: WorkspaceSession = await (await f.call('POST', path, { confirmed: true })).json();
    const second: WorkspaceSession = await (await f.call('POST', path, { confirmed: true })).json();
    const draft = await (await f.call('POST', `/api/sessions/${first.id}/drafts`, {
      path: 'package.json', side: 'new', line: 2, body: 'Publish this finding once',
    })).json();
    expect((await (await f.call('GET', `/api/sessions/${second.id}/comments`)).json()).drafts).toMatchObject([{ id: draft.id }]);
    const gate = f.pausePublish();
    let streams: string[];
    try {
      const firstResponse = await f.call('POST', `/api/sessions/${first.id}/publish`);
      await gate.started;
      const secondResponse = await f.call('POST', `/api/sessions/${second.id}/publish`);
      gate.release();
      streams = await Promise.all([firstResponse.text(), secondResponse.text()]);
    } finally {
      gate.release();
    }
    expect(f.publishCalls()).toBe(1);
    const results = streams.flatMap(stream => stream.trim() ? stream.trim().split('\n').map(line => JSON.parse(line)) : []);
    expect(results).toEqual([{ draftId: draft.id, ok: true, commentId: 901 }]);
    expect((await (await f.call('GET', `/api/sessions/${second.id}/comments`)).json()).drafts).toEqual([]);
  });

  it('rejects stale and closed checkout heads, hostile requests and duplicate processes', async () => {
    const f = await setup(); const p = await f.add();
    const path = `/api/workspace/projects/${p.id}/prs/241/checkout`;
    await f.advance();
    expect((await f.call('POST', path, { confirmed: true })).status).toBe(409);
    f.closePr();
    expect((await f.call('POST', path, { confirmed: true })).status).toBe(409);
    expect((await f.call('POST', '/api/workspace/refresh', {}, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await f.call('GET', '/api/workspace', undefined, { host: 'evil.example' })).status).toBe(403);
    await expect(createDaemon(f.opts)).rejects.toThrow('locked');
    await f.stop();
    await writeFile(join(f.root, 'state/workspace.json'), '{"projects":[{}]}');
    await expect(createDaemon(f.opts)).rejects.toThrow('Corrupt workspace state');
  });

  it('serializes overlapping refresh and shutdown without timing sleeps', async () => {
    const f = await setup(); const p = await f.add();
    const gate = f.pauseList();
    const refresh = f.call('POST', `/api/workspace/projects/${p.id}/refresh`);
    await gate.started;
    const queued = f.call('POST', '/api/workspace/refresh');
    const stopping = f.stop();
    gate.release();
    expect((await refresh).status).toBe(200);
    expect((await queued).status).toBe(503);
    await stopping;
    expect(f.listCalls()).toBe(4);
  });

  it('prevents overlapping periodic refreshes and stops scheduled work', async () => {
    let tick: (() => void) | undefined;
    const interval = globalThis.setInterval;
    vi.spyOn(globalThis, 'setInterval').mockImplementation((callback, ms, ...args) => {
      if (typeof callback === 'function') tick = () => callback(...args);
      return interval(callback, ms, ...args);
    });
    const f = await setup();
    await f.add();
    const gate = f.pauseList();
    if (!tick) throw new Error('Daemon did not register its interval');
    tick();
    await gate.started;
    tick();
    tick();
    const stopping = f.stop();
    gate.release();
    await stopping;
    expect(f.listCalls()).toBe(4);
    tick();
    expect(f.listCalls()).toBe(4);
  });

  it('bounds injected provider requests with an abort signal and releases shutdown', async () => {
    const f = await setup();
    await f.stop();
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    let entered = () => {};
    const started = new Promise<void>(r => { entered = r; });
    const hungFetch: typeof fetch = Object.assign((_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      entered();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    }, { preconnect: fetch.preconnect });
    const daemon = await createDaemon({ ...f.opts, fetch: hungFetch });
    cleanups.push(() => daemon.stop());
    const request = daemon.fetch(new Request('http://localhost/api/workspace/projects', {
      method: 'POST', body: JSON.stringify({ path: f.repo.root }),
    }));
    await started;
    const stopping = daemon.stop();
    controller.abort(new DOMException('Timed out', 'TimeoutError'));
    const response = await request;
    expect(response.status).toBe(200);
    expect((await response.json()).error).toContain('Timed out');
    expect(timeout).toHaveBeenCalledWith(15_000);
    await stopping;
  });

  it('serves SPA project and review routes without global review endpoints', async () => {
    const f = await setup();
    await f.stop();
    await writeFile(join(f.root, 'index.html'), '<html><body>Fixture app</body></html>');
    const daemon = await createDaemon({ ...f.opts, staticDir: f.root });
    cleanups.push(() => daemon.stop());
    for (const path of ['/', '/projects/p', '/review/s/']) {
      const response = await daemon.fetch(new Request('http://localhost' + path));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('Fixture app');
    }
    expect((await daemon.fetch(new Request('http://localhost/api/pr'))).status).toBe(404);
    expect((await daemon.fetch(new Request('http://evil.example/api/workspace'))).status).toBe(403);
  });

  it('binds VS Code lifecycle and independent handlers to concurrent sessions', async () => {
    const factories: { repoRoot: string; cacheDir: string; dataDir?: string }[] = [];
    const stopped: string[] = [];
    vi.spyOn(vscode, 'createVscode').mockImplementation(opts => {
      factories.push(opts);
      return {
        open: async (path, line) => `http://localhost/editor?root=${opts.repoRoot}&file=${path}&line=${line}`,
        stop: async () => { stopped.push(opts.repoRoot); },
      };
    });
    const f = await setup();
    const p = await f.add();
    const one: WorkspaceSession = await (await f.call('POST', `/api/workspace/projects/${p.id}/prs/241/checkout`, { confirmed: true })).json();
    const two: WorkspaceSession = await (await f.call('POST', `/api/workspace/projects/${p.id}/prs/242/checkout`, { confirmed: true })).json();
    expect(one.id).not.toBe(two.id);
    for (const session of [one, two]) {
      const api = `/api/sessions/${session.id}`;
      expect((await (await f.call('GET', `${api}/pr`)).json()).id).toBe(session.prId);
      const opened = await f.call('POST', `${api}/vscode/open`, { path: 'package.json', line: 2 });
      expect(opened.status).toBe(200);
      expect((await opened.json()).url).toContain(session.checkoutPath);
    }
    expect(factories).toHaveLength(2);
    expect(factories.map(o => o.cacheDir)).toEqual([f.opts.env.CRIEVER_CACHE_DIR, f.opts.env.CRIEVER_CACHE_DIR]);
    expect(new Set(factories.map(o => o.dataDir)).size).toBe(2);
    await f.stop();
    expect(stopped.sort()).toEqual(factories.map(o => o.repoRoot).sort());
  });

  it.each(['source', 'destination'] as const)('rejects unsafe %s IDs before fetching', async side => {
    const f = await setup();
    const fetchSpy = vi.spyOn(Git.prototype, 'fetch');
    const p = await f.add();
    const path = `/api/workspace/projects/${p.id}/prs/241/checkout`;
    for (const id of ['--upload-pack=bad', 'HEAD', 'abcdef', 'a'.repeat(41), 'a'.repeat(63), 'g'.repeat(40)]) {
      f.setIds(side === 'source' ? id : null, side === 'destination' ? id : null);
      await f.call('POST', `/api/workspace/projects/${p.id}/refresh`);
      expect((await f.call('POST', path, { confirmed: true })).status).toBe(409);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await f.git.run(['rev-parse', 'HEAD'])).stdout.trim()).toBe(f.repo.c3);
  });

  it.each(['unresolved', 'short', 'wrong', 'ambiguous'] as const)('rejects %s provider commit resolution', async failure => {
    const f = await setup('bitbucket', 60_000, true);
    const p = await f.add();
    if (failure === 'unresolved') f.setDetail('', 404);
    if (failure === 'short') f.setDetail(f.repo.c2.slice(0, 12));
    if (failure === 'wrong') f.setDetail(f.repo.c3);
    if (failure === 'ambiguous') f.setDetail('', 409);
    const fetchSpy = vi.spyOn(Git.prototype, 'fetch');
    const response = await f.call('POST', `/api/workspace/projects/${p.id}/prs/241/checkout`, { confirmed: true });
    expect(response.status, await response.clone().text()).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stores canonical review heads from short list revisions across restart', async () => {
    const f = await setup('bitbucket', 60_000, true);
    const p = await f.add();
    const prefix = `/api/workspace/projects/${p.id}`;
    const marked = await f.call('POST', `${prefix}/prs/241/reviewed`, { sourceHead: p.pullRequests[0]?.sourceHead });
    expect(marked.status).toBe(200);
    expect((await marked.json()).pullRequests[0]).toMatchObject({ sourceHead: f.repo.c2, reviewedHead: f.repo.c2, status: 'reviewed' });
    await f.restart();
    const refreshed: WorkspaceProject = await (await f.call('POST', `${prefix}/refresh`)).json();
    expect(refreshed.pullRequests[0]).toMatchObject({ sourceHead: f.repo.c2, reviewedHead: f.repo.c2, status: 'reviewed' });
    await f.advance();
    const updated: WorkspaceProject = await (await f.call('POST', `${prefix}/refresh`)).json();
    expect(updated.pullRequests[0]).toMatchObject({ sourceHead: f.repo.c3, reviewedHead: f.repo.c2, status: 'updated' });
  });

  it('canonicalizes persisted short reviewed heads before comparing subsequent updates', async () => {
    const f = await setup('bitbucket', 60_000, true);
    const p = await f.add();
    await f.stop();
    const path = join(f.root, 'state/workspace.json');
    const snapshot: WorkspaceSnapshot = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...snapshot, projects: [{
      ...p, pullRequests: p.pullRequests.map(pr => ({ ...pr, reviewedHead: pr.sourceHead, reviewedAt: '2026-09-01', status: 'reviewed' })),
    }] }));
    await f.restart();
    const prefix = `/api/workspace/projects/${p.id}`;
    const refreshed: WorkspaceProject = await (await f.call('POST', `${prefix}/refresh`)).json();
    expect(refreshed.error).toBeNull();
    expect(refreshed.pullRequests[0]).toMatchObject({ reviewedHead: f.repo.c2, sourceHead: f.repo.c2, status: 'reviewed' });
    await f.advance();
    const updated: WorkspaceProject = await (await f.call('POST', `${prefix}/refresh`)).json();
    expect(updated.pullRequests[0]).toMatchObject({ reviewedHead: f.repo.c2, sourceHead: f.repo.c3, status: 'updated' });
  });

  it.each(['github', 'bitbucket'] as const)('checks out exact %s revisions in the actual repository and leaves them after stop', async provider => {
    const f = await setup(provider);
    const p = await f.add();
    const path = `/api/workspace/projects/${p.id}/prs/241/checkout`;
    expect((await f.call('POST', path, { target: 'repository' })).status).toBe(400);
    expect((await f.call('POST', path, { confirmed: true, target: 'wrong' })).status).toBe(400);
    const response = await f.call('POST', path, { confirmed: true, target: 'repository' });
    expect(response.status, await response.clone().text()).toBe(200);
    const session: WorkspaceSession = await response.json();
    expect(session).toMatchObject({ checkoutTarget: 'repository', checkoutPath: f.repo.root, sourceHead: f.repo.c2 });
    expect((await f.git.run(['rev-parse', 'HEAD'])).stdout.trim()).toBe(f.repo.c2);
    expect((await f.git.run(['symbolic-ref', '-q', 'HEAD'], { allowFail: true })).code).toBe(1);
    expect((await f.git.run(['rev-parse', 'refs/heads/feat/virtual-list-review'])).stdout.trim()).toBe(f.repo.c3);
    expect((await f.call('GET', `/api/sessions/${session.id}/files`)).status).toBe(200);
    await f.stop();
    expect(existsSync(f.repo.root)).toBe(true);
    expect((await f.git.run(['rev-parse', 'HEAD'])).stdout.trim()).toBe(f.repo.c2);
  });

  it.each(['tracked', 'untracked'] as const)('rejects actual repository checkout with %s changes', async kind => {
    const f = await setup(); const p = await f.add();
    const file = join(f.repo.root, kind === 'tracked' ? 'package.json' : 'notes.txt');
    await writeFile(file, 'keep these changes');
    const status = (await f.git.run(['status', '--porcelain', '--untracked-files=all'])).stdout;
    expect((await f.call('POST', `/api/workspace/projects/${p.id}/prs/241/checkout`, { confirmed: true, target: 'repository' })).status).toBe(409);
    expect((await f.git.run(['status', '--porcelain', '--untracked-files=all'])).stdout).toBe(status);
    expect(await readFile(file, 'utf8')).toBe('keep these changes');
    expect((await f.git.run(['rev-parse', 'HEAD'])).stdout.trim()).toBe(f.repo.c3);
  });

  it('protects ignored files that a repository checkout would overwrite', async () => {
    const f = await setup(); const p = await f.add();
    await f.git.run(['checkout', '--detach', f.repo.main]);
    const file = 'src/devices/useDeviceRows.ts';
    await writeFile(join(f.repo.root, '.git/info/exclude'), `${file}\n`);
    await writeFile(join(f.repo.root, file), 'local ignored file');
    expect((await f.git.run(['status', '--porcelain'])).stdout).toBe('');
    const response = await f.call('POST', `/api/workspace/projects/${p.id}/prs/241/checkout`, { confirmed: true, target: 'repository' });
    expect(response.status, await response.clone().text()).toBe(409);
    expect(await readFile(join(f.repo.root, file), 'utf8')).toBe('local ignored file');
    expect((await f.git.run(['rev-parse', 'HEAD'])).stdout.trim()).toBe(f.repo.main);
  });

  it.each(['MERGE_HEAD', 'rebase-merge', 'index.lock'])('rejects actual checkout during %s operation', async operation => {
    const f = await setup(); const p = await f.add();
    const file = join(f.repo.root, '.git', operation);
    if (operation === 'rebase-merge') await mkdir(file);
    else await writeFile(file, f.repo.main);
    expect((await f.call('POST', `/api/workspace/projects/${p.id}/prs/241/checkout`, { confirmed: true, target: 'repository' })).status).toBe(409);
    expect(existsSync(file)).toBe(true);
    expect((await f.git.run(['rev-parse', 'HEAD'])).stdout.trim()).toBe(f.repo.c3);
  });

  it('expires replaced actual repository sessions only after a successful checkout and keeps temporary reviews', async () => {
    const stopped: string[] = [];
    vi.spyOn(vscode, 'createVscode').mockImplementation(opts => ({
      open: async () => opts.repoRoot,
      stop: async () => { stopped.push(opts.dataDir ?? opts.repoRoot); },
    }));
    const f = await setup(); const p = await f.add();
    const path = `/api/workspace/projects/${p.id}/prs/241/checkout`;
    const temporary: WorkspaceSession = await (await f.call('POST', path, { confirmed: true })).json();
    const actual: WorkspaceSession = await (await f.call('POST', path, { confirmed: true, target: 'repository' })).json();
    const draft = await (await f.call('POST', `/api/sessions/${actual.id}/drafts`, { path: 'package.json', side: 'new', line: 2, body: 'Shared finding' })).json();
    await writeFile(join(f.repo.root, 'notes.txt'), 'dirty');
    expect((await f.call('POST', path, { confirmed: true, target: 'repository' })).status).toBe(409);
    expect((await f.call('GET', `/api/sessions/${actual.id}/pr`)).status).toBe(200);
    expect(stopped).toEqual([]);
    await rm(join(f.repo.root, 'notes.txt'));
    await f.advance();
    await f.call('POST', `/api/workspace/projects/${p.id}/refresh`);
    const replacement: WorkspaceSession = await (await f.call('POST', path, { confirmed: true, target: 'repository' })).json();
    expect(replacement.sourceHead).toBe(f.repo.c3);
    expect((await f.call('GET', `/api/sessions/${actual.id}/pr`)).status).toBe(404);
    expect((await f.call('GET', `/api/workspace/sessions/${actual.id}`)).status).toBe(404);
    expect(stopped).toEqual([join(f.opts.env.CRIEVER_CACHE_DIR, 'vscode-sessions', actual.id)]);
    expect((await f.call('GET', `/api/sessions/${temporary.id}/pr`)).status).toBe(200);
    expect((await new Git(temporary.checkoutPath).run(['rev-parse', 'HEAD'])).stdout.trim()).toBe(f.repo.c2);
    expect((await (await f.call('GET', `/api/sessions/${replacement.id}/comments`)).json()).drafts).toMatchObject([{ id: draft.id }]);
    expect((await (await f.call('GET', `/api/sessions/${temporary.id}/comments`)).json()).drafts).toMatchObject([{ id: draft.id }]);
  });

  it.each(['temporary', 'repository'] as const)('rejects stale %s checkout races before creating or replacing sessions', async target => {
    const f = await setup('bitbucket', 60_000, true); const p = await f.add();
    const path = `/api/workspace/projects/${p.id}/prs/241/checkout`;
    const old: WorkspaceSession = await (await f.call('POST', path, { confirmed: true, target })).json();
    const gate = f.pauseComments();
    const pending = f.call('POST', path, { confirmed: true, target });
    try {
      await gate.started;
      await f.advance();
      gate.release();
      const response = await pending;
      expect(response.status, await response.clone().text()).toBe(409);
    } finally { gate.release(); }
    expect((await f.call('GET', `/api/sessions/${old.id}/pr`)).status).toBe(200);
    expect((await f.git.run(['rev-parse', 'HEAD'])).stdout.trim()).toBe(target === 'repository' ? f.repo.c2 : f.repo.c3);
  });

  it('rejects changes made while actual checkout preparation is running', async () => {
    const f = await setup(); const p = await f.add();
    const gate = f.pauseComments();
    const pending = f.call('POST', `/api/workspace/projects/${p.id}/prs/241/checkout`, { confirmed: true, target: 'repository' });
    try {
      await gate.started;
      await writeFile(join(f.repo.root, 'package.json'), 'new work in progress');
      gate.release();
      expect((await pending).status).toBe(409);
    } finally { gate.release(); }
    expect(await readFile(join(f.repo.root, 'package.json'), 'utf8')).toBe('new work in progress');
    expect((await f.git.run(['rev-parse', 'HEAD'])).stdout.trim()).toBe(f.repo.c3);
  });

  it('rejects destination changes during checkout preparation', async () => {
    const f = await setup('bitbucket', 60_000, true); const p = await f.add();
    const gate = f.pauseComments();
    const pending = f.call('POST', `/api/workspace/projects/${p.id}/prs/241/checkout`, { confirmed: true });
    try {
      await gate.started;
      f.setIds(null, f.repo.c1.slice(0, 12));
      gate.release();
      expect((await pending).status).toBe(409);
    } finally { gate.release(); }
    expect((await f.git.run(['worktree', 'list', '--porcelain'])).stdout.split('worktree ')).toHaveLength(2);
  });

  it('removes clean system temporary worktrees at stop', async () => {
    const f = await setup(); const p = await f.add();
    const session: WorkspaceSession = await (await f.call('POST', `/api/workspace/projects/${p.id}/prs/241/checkout`, { confirmed: true, target: 'temporary' })).json();
    expect(session.checkoutPath.startsWith(join(tmpdir(), 'criever-review-'))).toBe(true);
    expect(existsSync(session.checkoutPath)).toBe(true);
    await f.stop();
    expect(existsSync(session.checkoutPath)).toBe(false);
    expect((await f.git.run(['worktree', 'list', '--porcelain'])).stdout).not.toContain(session.checkoutPath);
    expect((await f.git.run(['rev-parse', 'HEAD'])).stdout.trim()).toBe(f.repo.c3);
  });

  it.each(['ignored', 'tracked'] as const)('preserves temporary worktrees with %s edits and logs their paths', async kind => {
    const f = await setup(); const p = await f.add();
    await writeFile(join(f.repo.root, '.git/info/exclude'), 'ignored-review.txt\n');
    const session: WorkspaceSession = await (await f.call('POST', `/api/workspace/projects/${p.id}/prs/241/checkout`, { confirmed: true })).json();
    const file = join(session.checkoutPath, kind === 'ignored' ? 'ignored-review.txt' : 'package.json');
    await writeFile(file, 'preserve my review changes');
    await f.stop();
    expect(await readFile(file, 'utf8')).toBe('preserve my review changes');
    expect(f.logs).toContain(`Preserved modified review worktree ${session.checkoutPath}`);
  });

  it.each(['empty', 'registered', 'modified'] as const)('cleans partial %s temporary creation safely', async failure => {
    const f = await setup(); const p = await f.add();
    const run = Git.prototype.run;
    let path = '';
    vi.spyOn(Git.prototype, 'run').mockImplementation(async function (this: Git, args, options) {
      if (args[0] === 'worktree' && args[1] === 'add') {
        path = args[3] ?? '';
        temporaryPaths.add(path);
        if (failure !== 'empty') await run.call(this, args, options);
        if (failure === 'modified') await writeFile(join(path, 'notes.txt'), 'keep partial edits');
        throw new Error('Failed worktree creation');
      }
      return run.call(this, args, options);
    });
    expect((await f.call('POST', `/api/workspace/projects/${p.id}/prs/241/checkout`, { confirmed: true })).status).toBe(500);
    expect(path).not.toBe('');
    expect(existsSync(path)).toBe(failure === 'modified');
    if (failure === 'modified') expect(await readFile(join(path, 'notes.txt'), 'utf8')).toBe('keep partial edits');
    expect((await f.git.run(['rev-parse', 'HEAD'])).stdout.trim()).toBe(f.repo.c3);
  });
});
