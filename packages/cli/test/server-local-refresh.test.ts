import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { Git } from '../src/git';
import { StateStore } from '../src/state';
import { LocalReviewStore } from '../src/localreview';
import { LocalProvider } from '../src/providers/local';
import { createHandler, type ServerDeps } from '../src/server';

// This exercises the real file, not a mock Provider: a local review's review.json is the live
// source of truth and an agent can write to it between two polls of the same running server.
let dir: string; let deps: ServerDeps; let head = '';
const sh = async (args: string[]) => { const p = Bun.spawn(['git', ...args], { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, stdout: 'pipe', stderr: 'pipe' }); await p.exited; return (await new Response(p.stdout).text()).trim(); };
const call = (path: string) => createHandler(deps)(new Request('http://x' + path));
const j = async (r: Promise<Response>) => (await r).json();

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'criever-srv-local-'));
  await sh(['init', '-q', '-b', 'main']);
  writeFileSync(join(dir, 'a.ts'), 'l1\n'); await sh(['add', '.']); await sh(['commit', '-qm', 'base']);
  head = await sh(['rev-parse', 'HEAD']);

  const git = new Git(dir);
  const store = new LocalReviewStore(LocalReviewStore.path(dir)); await store.load(); await store.ensureReview(head, head);
  const provider = new LocalProvider(git, store, head, head, 'main');
  const meta = await provider.meta();
  const stateStore = new StateStore(join(dir, 'state.json')); await stateStore.load();
  deps = {
    git, store: stateStore, provider, ws: 'local', repo: 'r', remote: '', mergeBase: head, staticDir: null, vscode: null,
    comments: await provider.listComments(), commits: [], meta,
  };
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('GET /api/comments for a local review', () => {
  it('re-reads review.json on every request instead of a startup snapshot', async () => {
    expect((await j(call('/api/comments'))).threads).toHaveLength(0);

    // A second LocalReviewStore instance stands in for the agent CLI writing concurrently
    // while this server is already running.
    const agentStore = new LocalReviewStore(LocalReviewStore.path(dir)); await agentStore.load();
    await agentStore.add({ path: null, line: null, side: 'new', body: 'agent note', author: 'agent', agentName: 'coding-agent', anchorCommit: head });

    const after = await j(call('/api/comments'));
    expect(after.threads).toHaveLength(1);
    expect(after.threads[0].root.body).toBe('agent note');
  });
});
