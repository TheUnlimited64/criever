import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startup } from '../src/startup';
import { createHandler } from '../src/server';
import { GitHubError } from '../src/github';

const root = mkdtempSync(join(tmpdir(), 'criever-github-'));
const work = join(root, 'work');
const remote = join(root, 'github.com', 'owner', 'repo.git');
const env = { GITHUB_TOKEN: 'test-token', CRIEVER_STATE_DIR: join(root, 'state'), XDG_CONFIG_HOME: join(root, 'config') };
let base = ''; let original = ''; let head = '';
let available = true; let lookupStatus = 200; let resolved = false; let submitted = false;
const requests: { path: string; method: string; body: Record<string, unknown> }[] = [];
const page = <T,>(nodes: T[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
const json = (data: unknown, status = 200) => Response.json(data, { status });
const sh = async (cwd: string, args: string[]) => {
  const p = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: {
    ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.test',
    GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.test',
  } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(err);
  return out.trim();
};
const rawPr = () => ({
  number: 8, title: 'GitHub review', body: 'Review description', html_url: 'https://github.com/owner/repo/pull/8',
  created_at: '2026-01-01T00:00:00Z', user: { login: 'author' },
  head: { ref: 'feat', sha: head }, base: { ref: 'main', sha: base },
});
const reviewComment = (id: number, body: string, commit = original, line = 2) => ({
  fullDatabaseId: String(id), body, createdAt: '2026-01-04T00:00:00Z', author: { login: 'reviewer' },
  path: 'a.txt', originalLine: line, originalCommit: { oid: commit }, diffSide: 'RIGHT',
});
const api = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  async fetch(req) {
    if (req.headers.get('Authorization') !== 'Bearer test-token') return json({ message: 'bad credentials' }, 401);
    const url = new URL(req.url);
    const body: Record<string, unknown> = req.method === 'POST' ? await req.json() : {};
    requests.push({ path: url.pathname, method: req.method, body });
    if (url.pathname === '/user') return json({ login: 'reviewer' });
    if (url.pathname === '/repos/owner/repo/pulls') {
      if (lookupStatus !== 200) return json({ message: 'access denied' }, lookupStatus);
      expect(url.searchParams.get('head')).toBe('owner:feat');
      return json(available ? [rawPr()] : []);
    }
    if (url.pathname === '/repos/owner/repo/pulls/8') return json(rawPr());
    if (url.pathname === '/repos/owner/repo/pulls/8/commits') return json([
      { sha: original, commit: { message: 'first change', committer: { date: '2026-01-02T00:00:00Z' } } },
      { sha: head, commit: { message: 'move line', committer: { date: '2026-01-03T00:00:00Z' } } },
    ]);
    if (url.pathname === '/repos/owner/repo/issues/8/comments') return json([
      { id: 900, body: 'Conversation', created_at: '2026-01-01T00:00:00Z', user: { login: 'author' } },
    ]);
    if (url.pathname === '/graphql') {
      if (String(body.query).includes('resolveReviewThread')) {
        expect(body.variables).toEqual({ id: 'thread-101' });
        resolved = true;
        return json({ data: { resolveReviewThread: { thread: { id: 'thread-101', isResolved: true } } } });
      }
      return json({ data: { repository: { pullRequest: { reviewThreads: page([
        { id: 'thread-101', diffSide: 'RIGHT', isResolved: resolved, comments: page([reviewComment(101, 'Original finding'), reviewComment(102, 'Reply')]) },
        ...(submitted ? [
          { id: 'thread-201', diffSide: 'RIGHT', isResolved: false, comments: page([reviewComment(201, 'First draft', head, 3)]) },
          { id: 'thread-202', diffSide: 'RIGHT', isResolved: false, comments: page([reviewComment(202, 'Second draft', head, 4)]) },
        ] : []),
      ]) } } } });
    }
    if (url.pathname === '/repos/owner/repo/pulls/8/reviews' && req.method === 'POST') return json({ id: 50 });
    if (url.pathname === '/repos/owner/repo/pulls/8/reviews/50/comments') return json([
      { id: 202, body: 'Second draft', path: 'a.txt', line: 4, side: 'RIGHT' },
      { id: 201, body: 'First draft', path: 'a.txt', line: 3, side: 'RIGHT' },
    ]);
    if (url.pathname === '/repos/owner/repo/pulls/8/reviews/50/events') { submitted = true; return json({ id: 50 }); }
    return json({ message: `Unhandled ${req.method} ${url.pathname}` }, 404);
  },
});
const wireFetch: typeof fetch = Object.assign(
  (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return fetch(new URL(url.pathname + url.search, api.url), init);
  },
  { preconnect: fetch.preconnect },
);

beforeAll(async () => {
  mkdirSync(work, { recursive: true }); mkdirSync(remote, { recursive: true });
  await sh(remote, ['init', '-q', '--bare']);
  await sh(work, ['init', '-q', '-b', 'main']);
  writeFileSync(join(work, 'a.txt'), 'one\ntwo\nthree\n');
  await sh(work, ['add', '.']); await sh(work, ['commit', '-qm', 'base']); base = await sh(work, ['rev-parse', 'HEAD']);
  await sh(work, ['checkout', '-qb', 'feat']);
  writeFileSync(join(work, 'a.txt'), 'one\nchanged\nthree\n');
  await sh(work, ['commit', '-qam', 'first change']); original = await sh(work, ['rev-parse', 'HEAD']);
  writeFileSync(join(work, 'a.txt'), 'prefix\none\nchanged\nthree\n');
  await sh(work, ['commit', '-qam', 'move line']); head = await sh(work, ['rev-parse', 'HEAD']);
  await sh(work, ['remote', 'add', 'origin', remote]);
  await sh(work, ['push', '-q', 'origin', 'main', 'feat', 'HEAD:refs/pull/8/head']);
});
beforeEach(() => { available = true; lookupStatus = 200; resolved = false; submitted = false; requests.length = 0; });
afterAll(() => { api.stop(true); rmSync(root, { recursive: true, force: true }); });

describe('GitHub browser review workflow', () => {
  it('loads a fork-safe PR ref, reanchors threads, publishes a batch and resolves through HTTP', async () => {
    const deps = await startup({ cwd: work, env, fetch: wireFetch, log: () => {} });
    expect(deps.provider.kind).toBe('github');
    expect(deps.store.file).toMatch(/github\/owner\/repo\/pr-8.json$/);
    const app = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: createHandler({ ...deps, staticDir: null, vscode: null }) });
    const call = (path: string, body?: unknown) => fetch(new URL(path, app.url), {
      method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    });
    try {
      expect(await (await call('/api/pr')).json()).toMatchObject({ kind: 'github', id: 8, description: 'Review description', sourceHead: head });
      expect(deps.commits.map(c => c.hash)).toEqual([head, original]);
      const comments = await (await call('/api/comments')).json();
      expect(comments.threads.find((t: { root: { id: number } }) => t.root.id === 101)).toMatchObject({
        anchor: { anchorCommit: original, line: 2 }, displayLine: 3, status: { status: 'moved', newLine: 3 },
        replies: [{ id: 102 }], root: { author: { isMe: true } },
      });
      expect(comments.threads.find((t: { root: { id: number } }) => t.root.id === 900).root.canResolve).toBe(false);
      expect((await (await call('/api/diff?path=a.txt')).json()).file.hunks.length).toBeGreaterThan(0);
      await call('/api/drafts', { path: 'a.txt', line: 3, side: 'new', body: 'First draft' });
      await call('/api/drafts', { path: 'a.txt', line: 4, side: 'new', body: 'Second draft' });
      const results = (await (await call('/api/publish', {})).text()).trim().split('\n').map(line => JSON.parse(line));
      expect(results.map(r => r.commentId)).toEqual([201, 202]);
      expect(deps.store.state.drafts).toEqual([]);
      const reviews = requests.filter(r => r.path === '/repos/owner/repo/pulls/8/reviews');
      expect(reviews).toHaveLength(1);
      expect(reviews[0]?.body).toMatchObject({ commit_id: head, comments: [
        { body: 'First draft', line: 3, side: 'RIGHT' }, { body: 'Second draft', line: 4, side: 'RIGHT' },
      ] });
      expect(submitted).toBe(true);
      expect((await call('/api/comments/101/resolve', {})).status).toBe(200);
      expect((await call('/api/refresh', {})).status).toBe(200);
      expect((await (await call('/api/comments')).json()).threads.find((t: { root: { id: number } }) => t.root.id === 101).root.resolved).toBe(true);
    } finally { app.stop(true); }
  });
  it('falls back to local review without GitHub credentials', async () => {
    const deps = await startup({ cwd: work, env: { ...env, GITHUB_TOKEN: undefined }, fetch: wireFetch, log: () => {} });
    expect(deps.provider.kind).toBe('local');
    expect(requests).toEqual([]);
  });
  it('falls back to local review when no open PR exists', async () => {
    available = false;
    const deps = await startup({ cwd: work, env, fetch: wireFetch, log: () => {} });
    expect(deps.provider.kind).toBe('local');
  });
  it('keeps rejected GitHub credentials fatal rather than silently falling back', async () => {
    lookupStatus = 403;
    await expect(startup({ cwd: work, env, fetch: wireFetch, log: () => {} })).rejects.toBeInstanceOf(GitHubError);
  });
  it('allows explicit local reviews without calling GitHub', async () => {
    const deps = await startup({ cwd: work, env, fetch: wireFetch, local: true, log: () => {} });
    expect(deps.provider.kind).toBe('local');
    expect(requests).toEqual([]);
  });
});
