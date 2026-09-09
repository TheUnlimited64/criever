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
});
