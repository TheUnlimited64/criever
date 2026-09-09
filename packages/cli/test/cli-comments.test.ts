import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommentsCli } from '../src/cli-comments';
import { LocalReviewStore } from '../src/localreview';

const mainTs = new URL('../src/main.ts', import.meta.url).pathname;

const sh = async (cwd: string, args: string[]) => {
  const p = Bun.spawn(['git', ...args], { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, stdout: 'pipe', stderr: 'pipe' });
  await p.exited; return (await new Response(p.stdout).text()).trim();
};

let dir: string;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'criever-clicomments-'));
  await sh(dir, ['init', '-q', '-b', 'main']);
  writeFileSync(join(dir, 'a.ts'), 'line1\nline2\nline3\n');
  await sh(dir, ['add', '.']); await sh(dir, ['commit', '-qm', 'base']);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function initReview() {
  const store = new LocalReviewStore(LocalReviewStore.path(dir));
  await store.load();
  await store.ensureReview('main', 'HEAD');
}

const captureLogs = () => {
  const out: string[] = []; const err: string[] = [];
  const origLog = console.log; const origErr = console.error;
  console.log = (...a: unknown[]) => out.push(a.join(' '));
  console.error = (...a: unknown[]) => err.push(a.join(' '));
  return { out, err, restore: () => { console.log = origLog; console.error = origErr; } };
};

describe('runCommentsCli', () => {
  it('no local review found → exit 2 with the documented message', async () => {
    const cap = captureLogs();
    const code = await runCommentsCli(['comments', 'list'], dir);
    cap.restore();
    expect(code).toBe(2);
    expect(cap.err.join('\n')).toMatch(/criever --local/);
  });

  it('comment add writes a comment with the right fields and default author agent', async () => {
    await initReview();
    const code = await runCommentsCli(['comment', 'add', '--path', 'a.ts', '--line', '2', '--body', 'N+1 query here'], dir);
    expect(code).toBe(0);
    const store = new LocalReviewStore(LocalReviewStore.path(dir)); await store.load();
    expect(store.review.comments).toHaveLength(1);
    const c = store.review.comments[0]!;
    expect(c).toMatchObject({ path: 'a.ts', line: 2, side: 'new', body: 'N+1 query here', author: 'agent', resolved: false, parentId: null });
    expect(c.anchorCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('--author me overrides the default and --agent-name is stored', async () => {
    await initReview();
    await runCommentsCli(['comment', 'add', '--path', 'a.ts', '--line', '1', '--body', 'hi', '--agent-name', 'coding-agent'], dir);
    await runCommentsCli(['comment', 'add', '--path', 'a.ts', '--line', '1', '--body', 'hi human', '--author', 'me'], dir);
    const store = new LocalReviewStore(LocalReviewStore.path(dir)); await store.load();
    expect(store.review.comments[0]).toMatchObject({ author: 'agent', agentName: 'coding-agent' });
    expect(store.review.comments[1]).toMatchObject({ author: 'me' });
    expect(store.review.comments[1]!.agentName).toBeUndefined();
  });

  it('--reply-to nests under the parent; an unknown parent exits 1 naming the fix', async () => {
    await initReview();
    await runCommentsCli(['comment', 'add', '--path', 'a.ts', '--line', '1', '--body', 'root'], dir);
    const store0 = new LocalReviewStore(LocalReviewStore.path(dir)); await store0.load();
    const rootId = store0.review.comments[0]!.id;

    const code = await runCommentsCli(['comment', 'add', '--path', 'a.ts', '--line', '1', '--body', 'reply', '--reply-to', String(rootId)], dir);
    expect(code).toBe(0);
    const store1 = new LocalReviewStore(LocalReviewStore.path(dir)); await store1.load();
    expect(store1.review.comments[1]).toMatchObject({ parentId: rootId, body: 'reply' });

    const cap = captureLogs();
    const badCode = await runCommentsCli(['comment', 'add', '--path', 'a.ts', '--line', '1', '--body', 'x', '--reply-to', '9999'], dir);
    cap.restore();
    expect(badCode).toBe(1);
    expect(cap.err.join('\n')).toMatch(/No such root comment 9999/);
  });

  it('comment resolve / comment rm change the file; unknown id exits 1', async () => {
    await initReview();
    await runCommentsCli(['comment', 'add', '--path', 'a.ts', '--line', '1', '--body', 'a'], dir);
    await runCommentsCli(['comment', 'add', '--path', 'a.ts', '--line', '2', '--body', 'b'], dir);
    const store0 = new LocalReviewStore(LocalReviewStore.path(dir)); await store0.load();
    const [idA, idB] = store0.review.comments.map(c => c.id);

    expect(await runCommentsCli(['comment', 'resolve', String(idA)], dir)).toBe(0);
    const store1 = new LocalReviewStore(LocalReviewStore.path(dir)); await store1.load();
    expect(store1.review.comments.find(c => c.id === idA)!.resolved).toBe(true);

    expect(await runCommentsCli(['comment', 'rm', String(idB)], dir)).toBe(0);
    const store2 = new LocalReviewStore(LocalReviewStore.path(dir)); await store2.load();
    expect(store2.review.comments.find(c => c.id === idB)).toBeUndefined();

    const cap = captureLogs();
    const code = await runCommentsCli(['comment', 'resolve', '9999'], dir);
    cap.restore();
    expect(code).toBe(1);
    expect(cap.err.join('\n')).toMatch(/No such comment 9999/);
  });

  it('comments list --json returns nested replies', async () => {
    await initReview();
    await runCommentsCli(['comment', 'add', '--path', 'src/api/devices.ts', '--line', '42', '--body', 'N+1 query here', '--agent-name', 'coding-agent'], dir);
    const store0 = new LocalReviewStore(LocalReviewStore.path(dir)); await store0.load();
    const rootId = store0.review.comments[0]!.id;
    await runCommentsCli(['comment', 'add', '--path', 'src/api/devices.ts', '--line', '42', '--body', 'fixed in c0ffee1, recheck', '--author', 'me', '--reply-to', String(rootId)], dir);

    const cap = captureLogs();
    const code = await runCommentsCli(['comments', 'list', '--json'], dir);
    cap.restore();
    expect(code).toBe(0);
    const shape = JSON.parse(cap.out.join('\n'));
    expect(shape).toEqual([{
      id: rootId, path: 'src/api/devices.ts', line: 42, side: 'new', author: 'agent',
      agentName: 'coding-agent', body: 'N+1 query here', resolved: false,
      replies: [{ id: shape[0].replies[0].id, author: 'me', body: 'fixed in c0ffee1, recheck' }],
    }]);
  });

  it('filters --unresolved, --mine, --agent, --path each narrow the roots', async () => {
    await initReview();
    await runCommentsCli(['comment', 'add', '--path', 'a.ts', '--line', '1', '--body', 'a', '--author', 'me'], dir);
    await runCommentsCli(['comment', 'add', '--path', 'b.ts', '--line', '1', '--body', 'b'], dir);
    const store0 = new LocalReviewStore(LocalReviewStore.path(dir)); await store0.load();
    const [meId, agentId] = store0.review.comments.map(c => c.id);
    await runCommentsCli(['comment', 'resolve', String(meId)], dir);

    const ids = async (args: string[]) => {
      const cap = captureLogs();
      await runCommentsCli(['comments', 'list', '--json', ...args], dir);
      cap.restore();
      return JSON.parse(cap.out.join('\n')).map((c: { id: number }) => c.id);
    };
    expect(await ids(['--unresolved'])).toEqual([agentId]);
    expect(await ids(['--mine'])).toEqual([meId]);
    expect(await ids(['--agent'])).toEqual([agentId]);
    expect(await ids(['--path', 'a.ts'])).toEqual([meId]);
  });

  it('an unknown flag exits 1 rather than being silently ignored', async () => {
    await initReview();
    const cap = captureLogs();
    const code = await runCommentsCli(['comments', 'list', '--bogus'], dir);
    cap.restore();
    expect(code).toBe(1);
    expect(cap.err.join('\n')).toMatch(/Unknown flag: --bogus/);
  });

  it('--body-file - reads multi-line markdown from stdin intact (real spawned process)', async () => {
    await initReview();
    const markdown = '## finding\n\n- N+1 query\n- fix: batch it\n';
    const p = Bun.spawn(['bun', 'run', mainTs, 'comment', 'add', '--path', 'a.ts', '--line', '3', '--body-file', '-', '--agent-name', 'coding-agent'], {
      cwd: dir, stdin: new TextEncoder().encode(markdown), stdout: 'pipe', stderr: 'pipe',
    });
    const code = await p.exited;
    const stderr = await new Response(p.stderr).text();
    expect(code, stderr).toBe(0);

    const store = new LocalReviewStore(LocalReviewStore.path(dir)); await store.load();
    expect(store.review.comments[0]!.body).toBe(markdown.replace(/\n$/, ''));
  });

  it('a real spawned process exits 2 with the documented message when no local review exists', async () => {
    const p = Bun.spawn(['bun', 'run', mainTs, 'comments', 'list'], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
    const code = await p.exited;
    const stderr = await new Response(p.stderr).text();
    expect(code).toBe(2);
    expect(stderr).toMatch(/criever --local/);
  });
});
