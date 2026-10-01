import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildFixtureRepo } from '../fixtures/repo';
import { createDaemon } from '../src/daemon';
import { Git } from '../src/git';
import { StateStore } from '../src/state';
import * as vscode from '../src/vscode';
import type { WorkspaceProject, WorkspaceSession, WorkspaceSnapshot } from '@criever/shared';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
const connection = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };

async function setup(provider: 'github' | 'bitbucket' = 'bitbucket', pollIntervalMs = 60_000) {
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
      if (p.endsWith('/comments')) return Response.json(provider === 'github' ? [] : { values: [] });
      if (p.endsWith('/commits')) return Response.json(provider === 'github' ? [] : { values: [] });
      const bb = {
        id: 241, state: closed ? 'MERGED' : 'OPEN', title: 'Review me', created_on: '2026-09-01', updated_on: '2026-09-02',
        author: { uuid: '{other}', display_name: 'Other' }, reviewers: [{ uuid: '{me}' }],
        links: { html: { href: 'https://bitbucket.org/o/r/pull-requests/241' } },
        source: { branch: { name: 'fork/branch-not-local' }, commit: { hash: head } },
        destination: { branch: { name: 'main' }, commit: { hash: repo.main } },
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
    env: { CRIEVER_STATE_DIR: join(root, 'state'), CRIEVER_CACHE_DIR: join(root, 'cache'), BITBUCKET_API_BASE: `${stub.url}2.0`,
      ATLASSIAN_USER_EMAIL: 'me', ATLASSIAN_API_TOKEN: 'token', GITHUB_TOKEN: 'token' },
    cwd: root, staticDir: null, log: () => {}, fetch: injected, pollIntervalMs,
  };
  let daemon = await createDaemon(opts);
  cleanups.push(() => daemon.stop());
  const call = (method: string, path: string, body?: unknown, headers?: HeadersInit) =>
    daemon.fetch(new Request('http://127.0.0.1:4917' + path, {
      method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers,
    }));
  const add = async (): Promise<WorkspaceProject> => {
    const response = await call('POST', '/api/workspace/projects', { path: repo.root });
    expect(response.status).toBe(200);
    return response.json();
  };
  return {
    root, repo, git, opts, call, add, calls, setFailure: (v: boolean) => { failure = v; },
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
    const worktree = new Git(join(f.root, 'state/worktrees', session.id));
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
    const f = await setup(); const p = await f.add();
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
      expect((await opened.json()).url).toContain(join(f.root, 'state/worktrees', session.id));
    }
    expect(factories).toHaveLength(2);
    expect(factories.map(o => o.cacheDir)).toEqual([f.opts.env.CRIEVER_CACHE_DIR, f.opts.env.CRIEVER_CACHE_DIR]);
    expect(new Set(factories.map(o => o.dataDir)).size).toBe(2);
    await f.stop();
    expect(stopped.sort()).toEqual(factories.map(o => o.repoRoot).sort());
  });
});
