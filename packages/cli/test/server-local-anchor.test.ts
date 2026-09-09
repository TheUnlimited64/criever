import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { Git } from '../src/git';
import { StateStore } from '../src/state';
import { LocalReviewStore } from '../src/localreview';
import { LocalProvider } from '../src/providers/local';
import { createHandler, type ServerDeps } from '../src/server';

const sh = (cwd: string) => async (args: string[]) => {
  const p = Bun.spawn(['git', ...args], { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, stdout: 'pipe', stderr: 'pipe' });
  await p.exited; return (await new Response(p.stdout).text()).trim();
};

describe('a local comment is re-anchored using its own anchorCommit, not an inferred one', () => {
  it('reflects the moved line the stored anchor implies, even though inferAnchor would guess wrong', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'criever-srv-anchor-'));
    const run = sh(dir);
    await run(['init', '-q', '-b', 'main']);
    writeFileSync(join(dir, 'a.ts'), 'line1\nline2\nline3\n');
    await run(['add', '.']); await run(['commit', '-qm', 'base']);
    const base = await run(['rev-parse', 'HEAD']);

    const git = new Git(dir);
    const store = new LocalReviewStore(LocalReviewStore.path(dir)); await store.load(); await store.ensureReview(base, 'HEAD');
    const provider = new LocalProvider(git, store, base, 'HEAD', 'main');

    // Comment added while HEAD is still `base`: its own anchorCommit is `base`.
    const rootId = await provider.publishComment({ raw: 'about line2', path: 'a.ts', line: 2, side: 'new' });

    // A later commit inserts two lines above it, so the commented content moves from line 2 to line 4.
    writeFileSync(join(dir, 'a.ts'), 'line1\nnew1\nnew2\nline2\nline3\n');
    await run(['commit', '-qam', 'insert above']);

    const meta = await provider.meta();
    const stateStore = new StateStore(join(dir, 'state.json')); await stateStore.load();
    const deps: ServerDeps = {
      git, store: stateStore, provider, ws: 'local', repo: 'r', remote: '', mergeBase: base, staticDir: null, vscode: null,
      comments: await provider.listComments(), commits: await provider.listCommits(), meta,
    };
    const res = await createHandler(deps)(new Request('http://x/api/comments'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const thread = body.threads.find((t: { root: { id: number } }) => t.root.id === rootId);
    // If the comment's own anchorCommit were ignored in favor of inferAnchor(), this thread would
    // report "same" at line 2 (inferAnchor falls back to the newest commit, i.e. HEAD itself, since
    // that commit postdates the comment) — the wrong line entirely.
    expect(thread.status).toMatchObject({ status: 'moved', newLine: 4 });
    expect(thread.displayLine).toBe(4);
    expect(thread.anchor.source).toBe('criever');

    rmSync(dir, { recursive: true, force: true });
  });
});

describe('GET /api/comments degrades a comment with an empty anchorCommit instead of 500ing', () => {
  it('returns 200 with the broken comment as "same" and the healthy comment unaffected', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'criever-srv-anchor-empty-'));
    const run = sh(dir);
    await run(['init', '-q', '-b', 'main']);
    writeFileSync(join(dir, 'a.ts'), 'line1\nline2\n');
    await run(['add', '.']); await run(['commit', '-qm', 'base']);
    const base = await run(['rev-parse', 'HEAD']);

    const git = new Git(dir);
    const store = new LocalReviewStore(LocalReviewStore.path(dir)); await store.load(); await store.ensureReview(base, 'HEAD');
    // One comment with a valid anchor, one with an empty one (e.g. corrupted/hand-edited review.json).
    const good = await store.add({ path: 'a.ts', line: 1, side: 'new', body: 'fine', author: 'agent', anchorCommit: base });
    await store.add({ path: 'a.ts', line: 2, side: 'new', body: 'broken anchor', author: 'agent', anchorCommit: '' });

    const provider = new LocalProvider(git, store, base, 'HEAD', 'main');
    const meta = await provider.meta();
    const stateStore = new StateStore(join(dir, 'state.json')); await stateStore.load();
    const deps: ServerDeps = {
      git, store: stateStore, provider, ws: 'local', repo: 'r', remote: '', mergeBase: base, staticDir: null, vscode: null,
      comments: await provider.listComments(), commits: await provider.listCommits(), meta,
    };
    const res = await createHandler(deps)(new Request('http://x/api/comments'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.threads).toHaveLength(2);
    const brokenThread = body.threads.find((t: { root: { body: string } }) => t.root.body === 'broken anchor');
    expect(brokenThread.status).toMatchObject({ status: 'same' });
    const goodThread = body.threads.find((t: { root: { id: number } }) => t.root.id === good.id);
    expect(goodThread.status).toMatchObject({ status: 'same' });

    rmSync(dir, { recursive: true, force: true });
  });
});
