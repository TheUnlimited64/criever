import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { Git } from '../src/git';
import { StateStore } from '../src/state';
import { createHandler, type ServerDeps } from '../src/server';
import type { Provider } from '../src/provider';
import type { BbComment } from '@criever/shared';

let dir: string; let deps: ServerDeps; let base = ''; let head = '';
const sh = async (args: string[]) => { const p = Bun.spawn(['git', ...args], { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, stdout: 'pipe', stderr: 'pipe' }); await p.exited; return (await new Response(p.stdout).text()).trim(); };
const call = (method: string, path: string, body?: unknown) => deps && createHandler(deps)(new Request('http://x' + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'content-type': 'application/json' } }));
const j = async (r: Promise<Response>) => (await r).json();

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'criever-srv-'));
  await sh(['init', '-q', '-b', 'main']); mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/a.ts'), 'l1\nl2\nl3\n'); await sh(['add', '.']); await sh(['commit', '-qm', 'base']); base = await sh(['rev-parse', 'HEAD']);
  await sh(['checkout', '-qb', 'feat']); writeFileSync(join(dir, 'src/a.ts'), 'l1\nl2x\nl3\nl4\n'); await sh(['add', '.']); await sh(['commit', '-qm', 'feat']); head = await sh(['rev-parse', 'HEAD']);
  const store = new StateStore(join(dir, 'state.json')); await store.load();
  const comments: BbComment[] = [{ id: 1, parentId: null, author: { name: 'Me', initials: 'ME', isMe: true }, createdOn: '2026-01-02T00:00:00Z', body: 'c', resolved: false, deleted: false, inline: { path: 'src/a.ts', from: null, to: 2 } }];
  const published: unknown[] = [];
  deps = {
    git: new Git(dir), store, ws: 'w', repo: 'r', remote: 'origin', mergeBase: base, comments, staticDir: null, vscode: null,
    commits: [{ hash: base, date: '2026-01-01T00:00:00Z', message: 'base' }, { hash: head, date: '2026-01-03T00:00:00Z', message: 'feat' }],
    meta: { id: 1, title: 'T', url: 'u', author: 'A', description: 'the description', sourceBranch: 'feat', sourceHead: head, destinationBranch: 'main', destinationHead: base },
    provider: {
      kind: 'bitbucket',
      meta: async () => deps.meta,
      listComments: async () => comments,
      listCommits: async () => deps.commits,
      publishComment: async (b: unknown) => { published.push(b); if ((b as { raw: string }).raw === 'fail') throw new Error('nope'); return 500 + published.length; },
      resolveComment: async () => {},
    } satisfies Provider,
  };
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('handler', () => {
  it('GET /api/pr', async () => {
    const pr = await j(call('GET', '/api/pr'));
    expect(pr).toMatchObject({ id: 1, sourceHead: head, mergeBase: base, sourceBranch: 'feat', localBehind: 0, lastSeenHead: null, description: 'the description' });
  });
  it('GET /api/files with counts and viewed derivation', async () => {
    let files = await j(call('GET', '/api/files'));
    expect(files).toEqual([{ path: 'src/a.ts', oldPath: 'src/a.ts', status: 'M', additions: 2, deletions: 1, viewed: false, draftCount: 0, changedCount: 1, openCount: 0 }]);
    await call('POST', '/api/viewed', { path: 'src/a.ts', viewed: true });
    files = await j(call('GET', '/api/files')); expect(files[0].viewed).toBe(true);
  });
  it('GET /api/files?base=&head= narrows the changed-file set', async () => {
    const files = await j(call('GET', `/api/files?base=${head}&head=${head}`));
    expect(files).toEqual([]);
    const full = await j(call('GET', '/api/files'));
    expect(full.map((f: { path: string }) => f.path)).toEqual(['src/a.ts']);
  });
  it('GET /api/diff default and with context', async () => {
    const d = await j(call('GET', '/api/diff?path=src/a.ts'));
    expect(d).toMatchObject({ base, head, context: 3 }); expect(d.file.hunks).toHaveLength(1);
    const d0 = await j(call('GET', `/api/diff?path=src/a.ts&context=0&base=${base}`)); expect(d0.file.hunks).toHaveLength(2);
    expect((await j(call('GET', '/api/diff?path=nope.ts'))).file).toBeNull();
  });
  it('GET /api/file, /api/tree, /api/search', async () => {
    expect((await j(call('GET', `/api/file?path=src/a.ts&at=${base}`))).content).toBe('l1\nl2\nl3\n');
    expect(await j(call('GET', `/api/tree?at=${head}`))).toEqual([{ path: 'src/a.ts' }]);
    expect(await j(call('GET', `/api/search?q=l2x&at=${head}`))).toEqual([{ path: 'src/a.ts', line: 2, text: 'l2x' }]);
    expect((await call('GET', '/api/search?q=')).status).toBe(400);
  });
  it('GET /api/comments computes status and persists inferred anchors', async () => {
    const c = await j(call('GET', '/api/comments'));
    expect(c.threads[0]).toMatchObject({ status: { status: 'changed', newLine: 2 }, displayLine: 2 });
    expect(deps.store.state.anchors[1]).toMatchObject({ source: 'inferred', anchorCommit: base });
  });
  it('drafts CRUD', async () => {
    const d = await j(call('POST', '/api/drafts', { path: 'src/a.ts', line: 2, side: 'new', body: 'hi' }));
    expect(d).toMatchObject({ body: 'hi', anchorCommit: head });
    expect((await j(call('PATCH', `/api/drafts/${d.id}`, { body: 'edited' }))).body).toBe('edited');
    expect((await call('PATCH', '/api/drafts/zzz', { body: 'x' })).status).toBe(404);
    expect((await j(call('GET', '/api/files')))[0].draftCount).toBe(1);
    expect((await call('DELETE', `/api/drafts/${d.id}`)).status).toBe(200);
  });
  it('POST /api/publish streams NDJSON and stops on failure', async () => {
    await call('POST', '/api/drafts', { path: 'src/a.ts', line: 2, side: 'new', body: 'ok' });
    await call('POST', '/api/drafts', { path: 'src/a.ts', line: 3, side: 'new', body: 'fail' });
    await call('POST', '/api/drafts', { path: 'src/a.ts', line: 4, side: 'new', body: 'later' });
    const text = await (await call('POST', '/api/publish')).text();
    const lines = text.trim().split('\n').map(l => JSON.parse(l));
    expect(lines.map(l => l.ok)).toEqual([true, false]);
    expect(lines[1].error).toBe('nope');
    expect(deps.store.state.drafts.map(d => d.body)).toEqual(['fail', 'later']);
  });
  it('POST /api/comments/:id/resolve flips resolved', async () => {
    expect((await call('POST', '/api/comments/1/resolve')).status).toBe(200);
    expect(deps.comments[0]!.resolved).toBe(true);
  });
  it('POST /api/seen sets lastSeenHead', async () => {
    await call('POST', '/api/seen'); expect((await j(call('GET', '/api/pr'))).lastSeenHead).toBe(head);
  });
  it('vscode 501 when unavailable; unknown route 404', async () => {
    expect((await call('POST', '/api/vscode/open', { path: 'a', line: 1 })).status).toBe(501);
    expect((await call('GET', '/nope')).status).toBe(404);
  });
  it('git failure → 500 with stderr in error', async () => {
    const r = await call('GET', '/api/file?path=a&at=notacommit');
    expect(r.status).toBe(200); // show returns null content for missing
    expect((await r.json()).content).toBeNull();
    const r2 = await call('GET', '/api/tree?at=notacommit'); expect(r2.status).toBe(500); expect((await r2.json()).error).toMatch(/fatal|not a valid|unknown revision/i);
  });
});
