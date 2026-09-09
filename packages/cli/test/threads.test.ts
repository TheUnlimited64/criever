import { describe, it, expect } from 'vitest';
import { buildThreads, inferAnchor } from '../src/threads';
import type { BbComment, Hunk, PrCommit } from '@criever/shared';

const commits: PrCommit[] = [
  { hash: 'c3', date: '2026-09-05T08:00:00Z', message: '' },
  { hash: 'c2', date: '2026-09-02T08:00:00Z', message: '' },
  { hash: 'c1', date: '2026-09-01T08:00:00Z', message: '' },
];
const c = (o: Partial<BbComment> & { id: number }): BbComment => ({
  parentId: null, author: { name: 'A', initials: 'A', isMe: false }, createdOn: '2026-09-03T00:00:00Z',
  body: 'b', resolved: false, deleted: false, inline: { path: 'a.ts', from: null, to: 10 }, ...o,
});
const H = (oldStart: number, oldLen: number, newStart: number, newLen: number): Hunk => ({ oldStart, oldLen, newStart, newLen, header: '', lines: [] });

describe('inferAnchor', () => {
  it('picks newest commit older than the comment', () =>
    expect(inferAnchor(c({ id: 1, createdOn: '2026-09-03T00:00:00Z' }), commits)).toEqual({ path: 'a.ts', line: 10, side: 'new', anchorCommit: 'c2', source: 'inferred' }));
  it('falls back to the oldest commit', () =>
    expect(inferAnchor(c({ id: 1, createdOn: '2026-08-01T00:00:00Z' }), commits)!.anchorCommit).toBe('c1'));
  it('old-side comment', () =>
    expect(inferAnchor(c({ id: 1, inline: { path: 'a.ts', from: 4, to: null } }), commits)).toMatchObject({ side: 'old', line: 4 }));
  it('null for general comments', () => expect(inferAnchor(c({ id: 1, inline: null }), commits)).toBeNull());
});

describe('buildThreads', () => {
  const hunksFor = async (anchor: string, path: string) => {
    if (path === 'gone.ts') return 'fileDeleted' as const;
    if (anchor === 'c2') return { hunks: [H(10, 1, 12, 2)], newPath: null };
    return { hunks: [], newPath: null };
  };
  it('groups replies, keeps order, computes changed status from a stored anchor', async () => {
    const { threads, newAnchors } = await buildThreads(
      [c({ id: 1, createdOn: '2026-09-03T00:00:00Z' }), c({ id: 2, parentId: 1, createdOn: '2026-09-04T00:00:00Z' }), c({ id: 3, parentId: 1, createdOn: '2026-09-03T12:00:00Z' })],
      { 1: { path: 'a.ts', line: 10, side: 'new', anchorCommit: 'c2', source: 'criever' } }, commits, hunksFor);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.replies.map(r => r.id)).toEqual([3, 2]);
    expect(threads[0]!.status).toMatchObject({ status: 'changed', newLine: 12 });
    expect(threads[0]!.displayLine).toBe(12);
    expect(newAnchors).toEqual({});
  });
  it('infers and returns anchors for foreign comments', async () => {
    const { threads, newAnchors } = await buildThreads([c({ id: 5, createdOn: '2026-09-06T00:00:00Z' })], {}, commits, hunksFor);
    expect(newAnchors[5]).toMatchObject({ anchorCommit: 'c3', source: 'inferred' });
    expect(threads[0]!.status).toEqual({ status: 'same' }); expect(threads[0]!.displayLine).toBe(10);
  });
  it('old-side comments are always same', async () => {
    const { threads } = await buildThreads([c({ id: 6, inline: { path: 'a.ts', from: 3, to: null } })], {}, commits, hunksFor);
    expect(threads[0]).toMatchObject({ displaySide: 'old', displayLine: 3, status: { status: 'same' } });
  });
  it('a rename follows the thread to the new path', async () => {
    const renamingHunksFor = async (anchor: string, path: string) => {
      if (path === 'a.ts' && anchor === 'c2') return { hunks: [H(10, 1, 12, 2)], newPath: 'b.ts' };
      return hunksFor(anchor, path);
    };
    const { threads } = await buildThreads(
      [c({ id: 20, createdOn: '2026-09-03T00:00:00Z' })],
      { 20: { path: 'a.ts', line: 10, side: 'new', anchorCommit: 'c2', source: 'criever' } }, commits, renamingHunksFor);
    expect(threads[0]).toMatchObject({ displayPath: 'b.ts', displayLine: 12, status: { status: 'changed' } });
  });
  it('fileDeleted', async () => {
    const { threads } = await buildThreads([c({ id: 7, inline: { path: 'gone.ts', from: null, to: 1 } })], {}, commits, hunksFor);
    expect(threads[0]).toMatchObject({ status: { status: 'fileDeleted' }, displayLine: null });
  });
  it('general comments have null path and status', async () => {
    const { threads } = await buildThreads([c({ id: 8, inline: null })], {}, commits, hunksFor);
    expect(threads[0]).toMatchObject({ displayPath: null, displayLine: null, status: null, anchor: null });
  });
  it('drops deleted roots, keeps threads sorted by root createdOn', async () => {
    const { threads } = await buildThreads([c({ id: 9, deleted: true }), c({ id: 10, createdOn: '2026-09-09T00:00:00Z' }), c({ id: 11, createdOn: '2026-09-08T00:00:00Z' })], {}, commits, hunksFor);
    expect(threads.map(t => t.root.id)).toEqual([11, 10]);
  });
  it('a depth-2 reply must not be dropped from a synthetic review thread', async () => {
    const { threads } = await buildThreads([
      c({ id: 701, createdOn: '2026-09-01T10:00:00Z' }),
      c({ id: 702, parentId: 701, createdOn: '2026-09-01T10:05:00Z' }),
      c({ id: 703, parentId: 701, createdOn: '2026-09-01T10:10:00Z' }),
      c({ id: 704, parentId: 703, createdOn: '2026-09-01T10:15:00Z' }),
    ], {}, commits, hunksFor);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.root.id).toBe(701);
    expect(threads[0]!.replies.map(r => r.id)).toEqual([702, 703, 704]);
  });
  it('walks a reply chain deeper than 2 levels to find the root', async () => {
    const { threads } = await buildThreads([
      c({ id: 1, createdOn: '2026-09-01T00:00:00Z' }),
      c({ id: 2, parentId: 1, createdOn: '2026-09-01T00:01:00Z' }),
      c({ id: 3, parentId: 2, createdOn: '2026-09-01T00:02:00Z' }),
      c({ id: 4, parentId: 3, createdOn: '2026-09-01T00:03:00Z' }),
      c({ id: 5, parentId: 4, createdOn: '2026-09-01T00:04:00Z' }),
    ], {}, commits, hunksFor);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.root.id).toBe(1);
    expect(threads[0]!.replies.map(r => r.id)).toEqual([2, 3, 4, 5]);
  });
  it('a parent cycle (a -> b -> a) terminates instead of hanging, and both comments still show', async () => {
    const { threads } = await buildThreads([
      c({ id: 1, parentId: 2, createdOn: '2026-09-01T00:00:00Z' }),
      c({ id: 2, parentId: 1, createdOn: '2026-09-01T00:01:00Z' }),
    ], {}, commits, hunksFor);
    const shown = threads.flatMap(t => [t.root.id, ...t.replies.map(r => r.id)]);
    expect(shown.sort()).toEqual([1, 2]);
  });
  it('an orphan reply (parent missing from the fetched page) is promoted to its own root, not dropped', async () => {
    const { threads } = await buildThreads([
      c({ id: 1, parentId: 999, createdOn: '2026-09-01T00:00:00Z' }),
      c({ id: 2, createdOn: '2026-09-02T00:00:00Z' }),
    ], {}, commits, hunksFor);
    expect(threads.map(t => t.root.id).sort()).toEqual([1, 2]);
  });
  it('a live reply under a deleted intermediate comment still reaches its root', async () => {
    const { threads } = await buildThreads([
      c({ id: 1, createdOn: '2026-09-01T00:00:00Z' }),
      c({ id: 2, parentId: 1, deleted: true, createdOn: '2026-09-01T00:01:00Z' }),
      c({ id: 3, parentId: 2, createdOn: '2026-09-01T00:02:00Z' }),
    ], {}, commits, hunksFor);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.root.id).toBe(1);
    expect(threads[0]!.replies.map(r => r.id)).toEqual([3]);
  });
  it('an empty anchorCommit degrades to "same" instead of diffing an empty revision, and does not affect other comments', async () => {
    const { threads } = await buildThreads(
      [c({ id: 12 }), c({ id: 13, createdOn: '2026-09-03T00:00:00Z' })],
      { 12: { path: 'a.ts', line: 10, side: 'new', anchorCommit: '', source: 'criever' }, 13: { path: 'a.ts', line: 10, side: 'new', anchorCommit: 'c2', source: 'criever' } },
      commits, hunksFor);
    expect(threads.find(t => t.root.id === 12)).toMatchObject({ status: { status: 'same' }, displayLine: 10 });
    // sibling comment with a real anchor still re-anchors normally
    expect(threads.find(t => t.root.id === 13)).toMatchObject({ status: { status: 'changed', newLine: 12 } });
  });
  it('a hunksFor failure for one anchor degrades that comment to "same" without failing the others', async () => {
    const throwingHunksFor = async (anchor: string, path: string) => { if (anchor === 'bad') throw new Error(`git diff '' failed`); return hunksFor(anchor, path); };
    const { threads } = await buildThreads(
      [c({ id: 14 }), c({ id: 15, createdOn: '2026-09-03T00:00:00Z' })],
      { 14: { path: 'a.ts', line: 10, side: 'new', anchorCommit: 'bad', source: 'criever' }, 15: { path: 'a.ts', line: 10, side: 'new', anchorCommit: 'c2', source: 'criever' } },
      commits, throwingHunksFor);
    expect(threads.find(t => t.root.id === 14)).toMatchObject({ status: { status: 'same' } });
    expect(threads.find(t => t.root.id === 15)).toMatchObject({ status: { status: 'changed', newLine: 12 } });
  });
});
