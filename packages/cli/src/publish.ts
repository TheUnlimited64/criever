import type { Draft, PublishResult } from '@criever/shared';
import type { StateStore } from './state';

const publications = new WeakMap<StateStore, Promise<void>>();

export async function* publishDrafts(store: StateStore, publish: (d: Draft) => Promise<number>, batch?: (drafts: Draft[]) => Promise<number[]>): AsyncGenerator<PublishResult> {
  const previous = publications.get(store);
  const current = Promise.withResolvers<void>();
  publications.set(store, current.promise);
  await previous;
  try {
    let drafts = [...store.state.drafts].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const roots = drafts.filter(d => d.parentId == null);
    if (batch && roots.length) {
      let ids: number[];
      try {
        ids = await batch(roots);
      } catch (e) {
        for (const d of roots) yield { draftId: d.id, ok: false, error: e instanceof Error ? e.message : String(e) };
        return;
      }
      for (const [i, d] of roots.entries()) {
        const commentId = ids[i];
        if (commentId == null) throw new Error('Provider returned an incomplete comment batch');
        await store.removeDraft(d.id);
        await store.setAnchor(commentId, { path: d.path, line: d.line, side: d.side, anchorCommit: d.anchorCommit, source: 'criever' });
        yield { draftId: d.id, ok: true, commentId };
      }
      drafts = drafts.filter(d => d.parentId != null);
    }
    for (const d of drafts) {
      try {
        const commentId = await publish(d);
        await store.removeDraft(d.id);
        await store.setAnchor(commentId, { path: d.path, line: d.line, side: d.side, anchorCommit: d.anchorCommit, source: 'criever' });
        yield { draftId: d.id, ok: true, commentId };
      } catch (e) {
        yield { draftId: d.id, ok: false, error: e instanceof Error ? e.message : String(e) };
        return;
      }
    }
  } finally {
    current.resolve();
    if (publications.get(store) === current.promise) publications.delete(store);
  }
}
