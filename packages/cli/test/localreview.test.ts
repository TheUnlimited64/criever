import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import type { LocalComment } from '@criever/shared';
import { LocalReviewStore, emptyReview } from '../src/localreview';

const pkgRoot = new URL('..', import.meta.url).pathname;
const spawnWorker = (f: string, count: number, author: 'me' | 'agent') =>
  Bun.spawn(['bun', 'run', 'fixtures/local-review-worker.ts', f, String(count), author], { cwd: pkgRoot, stdout: 'ignore', stderr: 'inherit' });

let dir: string; let file: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'criever-review-')); file = LocalReviewStore.path(dir); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const draft = (over: Partial<Omit<LocalComment, 'id' | 'createdAt' | 'resolved' | 'parentId'>> = {}) => ({
  path: 'a.ts', line: 1, side: 'new' as const, body: 'hi', author: 'me' as const, anchorCommit: 'abc', ...over,
});

describe('LocalReviewStore', () => {
  it('path layout', () => expect(file).toBe(join(dir, '.criever', 'review.json')));

  it('load on missing file yields empty review and no warning', async () => {
    const s = new LocalReviewStore(file); await s.load();
    expect(s.review).toEqual(emptyReview()); expect(s.warning).toBeNull();
  });

  it('ensureReview creates the file with base/head', async () => {
    const s = new LocalReviewStore(file); await s.load();
    await s.ensureReview('main', 'HEAD');
    expect(s.review.base).toBe('main'); expect(s.review.head).toBe('HEAD');
    const s2 = new LocalReviewStore(file); await s2.load();
    expect(s2.review.base).toBe('main'); expect(s2.review.head).toBe('HEAD');
  });

  it('round-trip: add, reload from a second instance, comments and nextId survive', async () => {
    const s = new LocalReviewStore(file); await s.load();
    const c = await s.add(draft());
    expect(c.id).toBe(1); expect(c.resolved).toBe(false); expect(c.parentId).toBeNull();
    expect(c.createdAt).toMatch(/^\d{4}-/);
    const s2 = new LocalReviewStore(file); await s2.load();
    expect(s2.review.comments).toEqual([c]);
    expect(s2.review.nextId).toBe(2);
    expect(existsSync(file + '.tmp')).toBe(false);
  });

  it('ids are monotonic across reloads', async () => {
    const s = new LocalReviewStore(file); await s.load();
    const c1 = await s.add(draft());
    expect(c1.id).toBe(1);
    const s2 = new LocalReviewStore(file); await s2.load();
    const c2 = await s2.add(draft());
    expect(c2.id).toBe(2);
  });

  it('reply nests under its parent and returns null for an unknown parent', async () => {
    const s = new LocalReviewStore(file); await s.load();
    const root = await s.add(draft());
    const r = await s.reply(root.id, draft({ body: 'reply', author: 'agent' }));
    expect(r).not.toBeNull();
    expect(r!.parentId).toBe(root.id);
    expect(await s.reply(999, draft())).toBeNull();
  });

  it('reply rejects nesting under a reply (flat one level)', async () => {
    const s = new LocalReviewStore(file); await s.load();
    const root = await s.add(draft());
    const r = await s.reply(root.id, draft());
    expect(await s.reply(r!.id, draft())).toBeNull();
  });

  it('resolve targets a root and rejects a reply id', async () => {
    const s = new LocalReviewStore(file); await s.load();
    const root = await s.add(draft());
    const r = await s.reply(root.id, draft());
    expect(await s.resolve(root.id)).toBe(true);
    expect(s.review.comments.find(c => c.id === root.id)!.resolved).toBe(true);
    expect(await s.resolve(r!.id)).toBe(false);
    expect(await s.resolve(999)).toBe(false);
  });

  it('remove of a root also removes its replies', async () => {
    const s = new LocalReviewStore(file); await s.load();
    const root = await s.add(draft());
    const other = await s.add(draft({ path: 'b.ts' }));
    await s.reply(root.id, draft());
    await s.reply(root.id, draft());
    expect(await s.remove(root.id)).toBe(true);
    expect(s.review.comments).toEqual([other]);
    expect(await s.remove(root.id)).toBe(false);
  });

  it('filters: unresolved, by author, by path', async () => {
    const s = new LocalReviewStore(file); await s.load();
    const a = await s.add(draft({ path: 'a.ts', author: 'me' }));
    const b = await s.add(draft({ path: 'b.ts', author: 'agent' }));
    await s.resolve(a.id);
    expect(s.list({ unresolved: true }).map(c => c.id)).toEqual([b.id]);
    expect(s.list({ author: 'agent' }).map(c => c.id)).toEqual([b.id]);
    expect(s.list({ path: 'a.ts' }).map(c => c.id)).toEqual([a.id]);
    expect(s.list()).toHaveLength(2);
  });

  it('corrupt file → .bak + empty state + warning naming the path', async () => {
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, '{not json');
    const s = new LocalReviewStore(file); await s.load();
    expect(s.review).toEqual(emptyReview());
    expect(s.warning).toMatch(new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.bak'));
    expect(existsSync(file + '.bak')).toBe(true);
  });

  it('concurrency: two store instances adding comments in Promise.all do not lose a comment and leave no .tmp', async () => {
    const s1 = new LocalReviewStore(file); await s1.load();
    await s1.ensureReview('main', 'HEAD');
    const s2 = new LocalReviewStore(file); await s2.load();
    await Promise.all([
      s1.add(draft({ path: 'a.ts' })),
      s1.add(draft({ path: 'a.ts' })),
      s2.add(draft({ path: 'b.ts' })),
      s2.add(draft({ path: 'b.ts' })),
    ]);
    const s3 = new LocalReviewStore(file); await s3.load();
    // This proves in-process cross-instance safety (the shared per-file write queue merges
    // a fresh disk read into each mutation's critical section) — it does NOT prove the
    // cross-process case (separate `criever` CLI and server processes have no shared queue
    // and can still race a read-modify-write); see the `mutate()` documentation for the same caveat.
    expect(existsSync(file + '.tmp')).toBe(false);
    expect(readdirSync(dirname(file)).filter(f => f.endsWith('.tmp'))).toEqual([]);
    expect(s3.review.comments).toHaveLength(4);
    expect(new Set(s3.review.comments.map(c => c.id)).size).toBe(4);
  });

  it('cross-process: two real spawned processes adding comments concurrently do not lose any and leave no .lock/.tmp', async () => {
    const s0 = new LocalReviewStore(file); await s0.load(); await s0.ensureReview('main', 'HEAD');
    const p1 = spawnWorker(file, 5, 'me');
    const p2 = spawnWorker(file, 5, 'agent');
    const [e1, e2] = await Promise.all([p1.exited, p2.exited]);
    expect(e1).toBe(0); expect(e2).toBe(0);

    const s = new LocalReviewStore(file); await s.load();
    expect(s.review.comments).toHaveLength(10);
    expect(new Set(s.review.comments.map(c => c.id)).size).toBe(10);
    const leftovers = readdirSync(dirname(file)).filter(f => f.endsWith('.lock') || f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  }, 15000);

  it('a stale lock (old mtime) is removed rather than hanging forever', async () => {
    mkdirSync(dirname(file), { recursive: true });
    const lockPath = file + '.lock';
    writeFileSync(lockPath, '999999 stale');
    const old = new Date(Date.now() - 20_000);
    utimesSync(lockPath, old, old);

    const s = new LocalReviewStore(file); await s.load();
    const c = await s.add(draft());
    expect(c.id).toBe(1);
    expect(existsSync(lockPath)).toBe(false);
  }, 5000);
});
