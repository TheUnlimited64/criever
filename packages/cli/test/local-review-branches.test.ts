import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startup } from '../src/startup';
import { createHandler } from '../src/server';
import { runCommentsCli } from '../src/cli-comments';
import { LocalReviewStore } from '../src/localreview';

let dir: string;
const git = async (...args: string[]) => {
  const p = Bun.spawn(['git', ...args], {
    cwd: dir, stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
  const stdout = await new Response(p.stdout).text();
  expect(await p.exited, await new Response(p.stderr).text()).toBe(0);
  return stdout.trim();
};
const openReview = () => startup({
  cwd: dir, local: true, base: 'main', log: () => {},
  env: { CRIEVER_STATE_DIR: join(dir, '.criever', 'state') },
});

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'criever-branches-'));
  await git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.ts'), 'base\n');
  await git('add', '.'); await git('commit', '-qm', 'base');
  await git('checkout', '-qb', 'feature/a');
  writeFileSync(join(dir, 'a.ts'), 'branch A\n');
  await git('commit', '-qam', 'A');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('local reviews across branches', () => {
  it('preserves unscoped legacy comments without assigning them to this branch', async () => {
    const legacy = new LocalReviewStore(LocalReviewStore.path(dir));
    await legacy.add({ path: 'a.ts', line: 1, side: 'new', body: 'unknown branch', author: 'me', anchorCommit: await git('rev-parse', 'HEAD') });
    const original = readFileSync(legacy.file, 'utf8');
    expect((await openReview()).comments).toEqual([]);
    expect(readFileSync(legacy.file, 'utf8')).toBe(original);
  });

  it('isolates comments and drafts on B, then restores A on reopening', async () => {
    const a = await openReview();
    await a.provider.publishComment({ raw: 'A comment', path: 'a.ts', line: 1, side: 'new' });
    await a.store.addDraft({ path: 'a.ts', line: 1, side: 'new', body: 'A draft', anchorCommit: a.meta.sourceHead });
    await git('checkout', '-qb', 'feature/b', 'main');
    writeFileSync(join(dir, 'a.ts'), 'branch B\n');
    await git('commit', '-qam', 'B');
    const b = await openReview();
    expect(b.comments).toEqual([]);
    expect(b.store.state.drafts).toEqual([]);
    await b.provider.publishComment({ raw: 'B comment', path: 'a.ts', line: 1, side: 'new' });
    await git('checkout', '-q', 'feature/a');
    const reopened = await openReview();
    expect(reopened.comments.map(c => c.body)).toEqual(['A comment']);
    expect(reopened.store.state.drafts.map(d => d.body)).toEqual(['A draft']);
  });

  it('retains saved comments when the same branch advances', async () => {
    const a = await openReview();
    await a.provider.publishComment({ raw: 'keep me', path: 'a.ts', line: 1, side: 'new' });
    writeFileSync(join(dir, 'a.ts'), 'branch A\nnew line\n');
    await git('commit', '-qam', 'advance A');
    const reopened = await openReview();
    expect(reopened.meta.sourceHead).not.toBe(a.meta.sourceHead);
    expect(reopened.comments.map(c => c.body)).toEqual(['keep me']);
  });

  it('keeps the same branch comments when the review base changes', async () => {
    const a = await openReview();
    await a.provider.publishComment({ raw: 'keep me', path: 'a.ts', line: 1, side: 'new' });
    const reopened = await startup({
      cwd: dir, local: true, base: a.meta.sourceHead, log: () => {},
      env: { CRIEVER_STATE_DIR: join(dir, '.criever', 'state') },
    });
    expect(reopened.comments.map(c => c.body)).toEqual(['keep me']);
  });

  it('keeps a running A review bound to A after checkout and refresh', async () => {
    const a = await openReview();
    await a.provider.publishComment({ raw: 'A comment', path: 'a.ts', line: 1, side: 'new' });
    const deps = { ...a, staticDir: null, vscode: null };
    const handler = createHandler(deps);
    await git('checkout', '-qb', 'feature/b', 'main');
    writeFileSync(join(dir, 'a.ts'), 'branch B\n');
    await git('commit', '-qam', 'B');
    expect((await handler(new Request('http://x/api/refresh', { method: 'POST' }))).status).toBe(200);
    expect(deps.meta.sourceHead).toBe(a.meta.sourceHead);
    expect(deps.meta.sourceBranch).toBe('feature/a');
    const b = await openReview();
    await b.provider.publishComment({ raw: 'B comment', path: 'a.ts', line: 1, side: 'new' });
    expect((await a.provider.listComments()).map(c => c.body)).toEqual(['A comment']);
  });

  it('does not let the comment CLI write to A while B has no review', async () => {
    await openReview();
    await git('checkout', '-qb', 'feature/b', 'main');
    expect(await runCommentsCli(['comment', 'add', '--path', 'a.ts', '--line', '1', '--body', 'B note'], dir)).toBe(2);
    await git('checkout', '-q', 'feature/a');
    expect((await openReview()).comments).toEqual([]);
  });
});
