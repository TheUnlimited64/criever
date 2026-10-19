import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { StateStore } from '../src/state';
import { publishDrafts } from '../src/publish';

async function store() {
  const s = new StateStore(join(mkdtempSync(join(tmpdir(), 'pub-')), 'pr.json')); await s.load();
  const a = await s.addDraft({ path: 'a.ts', line: 1, side: 'new', body: 'one', anchorCommit: 'h' });
  const b = await s.addDraft({ path: 'a.ts', line: 2, side: 'new', body: 'two', anchorCommit: 'h', parentId: 9 });
  const c = await s.addDraft({ path: 'b.ts', line: 3, side: 'old', body: 'three', anchorCommit: 'h' });
  return { s, a, b, c };
}
const collect = async <T>(g: AsyncGenerator<T>) => { const out: T[] = []; for await (const x of g) out.push(x); return out; };

describe('publishDrafts', () => {
  it('batches roots before publishing replies individually', async () => {
    const { s, a, b, c } = await store();
    const calls: string[] = [];
    const results = await collect(publishDrafts(s, async d => { calls.push(d.body); return 103; }, async drafts => {
      calls.push(drafts.map(d => d.body).join(','));
      return [101, 102];
    }));
    expect(calls).toEqual(['one,three', 'two']);
    expect(results.map(r => r.draftId)).toEqual([a.id, c.id, b.id]);
    expect(s.state.drafts).toEqual([]);
  });
  it('publishes new inline drafts as one batch and saves returned anchors', async () => {
    const { s, b } = await store();
    await s.removeDraft(b.id);
    let calls = 0;
    const results = await collect(publishDrafts(s, async () => { throw new Error('unexpected single publish'); }, async drafts => {
      calls++;
      expect(drafts.map(d => d.body)).toEqual(['one', 'three']);
      return [101, 102];
    }));
    expect(calls).toBe(1);
    expect(results.map(r => r.commentId)).toEqual([101, 102]);
    expect(s.state.drafts).toEqual([]);
    expect(s.state.anchors[102]).toMatchObject({ side: 'old', anchorCommit: 'h' });
  });
  it('keeps the entire draft batch when the provider rejects it', async () => {
    const { s, b } = await store();
    await s.removeDraft(b.id);
    const results = await collect(publishDrafts(s, async () => 0, async () => { throw new Error('denied'); }));
    expect(results.map(r => r.ok)).toEqual([false, false]);
    expect(s.state.drafts.map(d => d.body)).toEqual(['one', 'three']);
    expect(s.state.anchors).toEqual({});
  });
  it('publishes in order, removes drafts, records anchors', async () => {
    const { s, a, b, c } = await store(); let n = 100;
    const results = await collect(publishDrafts(s, async () => ++n));
    expect(results).toEqual([{ draftId: a.id, ok: true, commentId: 101 }, { draftId: b.id, ok: true, commentId: 102 }, { draftId: c.id, ok: true, commentId: 103 }]);
    expect(s.state.drafts).toEqual([]);
    expect(s.state.anchors[103]).toEqual({ path: 'b.ts', line: 3, side: 'old', anchorCommit: 'h', source: 'criever' });
  });
  it('stops at the first failure, keeps that and later drafts', async () => {
    const { s, a, b, c } = await store();
    const results = await collect(publishDrafts(s, async d => { if (d.body === 'two') throw new Error('boom'); return 7; }));
    expect(results).toEqual([{ draftId: a.id, ok: true, commentId: 7 }, { draftId: b.id, ok: false, error: 'boom' }]);
    expect(s.state.drafts.map(d => d.id)).toEqual([b.id, c.id]);
  });
  it('allows a later publication after a rejected batch', async () => {
    const { s, a, b, c } = await store();
    await collect(publishDrafts(s, async () => 0, async () => { throw new Error('denied'); }));
    let id = 100;
    const results = await collect(publishDrafts(s, async () => ++id));
    expect(results).toEqual([
      { draftId: a.id, ok: true, commentId: 101 },
      { draftId: b.id, ok: true, commentId: 102 },
      { draftId: c.id, ok: true, commentId: 103 },
    ]);
  });
  it('releases remaining drafts when a publication stream is closed early', async () => {
    const { s, b, c } = await store();
    const first = publishDrafts(s, async () => 100);
    await first.next();
    await first.return(undefined);
    let id = 100;
    const results = await collect(publishDrafts(s, async () => ++id));
    expect(results).toEqual([
      { draftId: b.id, ok: true, commentId: 101 },
      { draftId: c.id, ok: true, commentId: 102 },
    ]);
  });
});
