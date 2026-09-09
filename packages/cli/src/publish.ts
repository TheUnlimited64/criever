import type { Draft, PublishResult } from '@criever/shared';
import type { StateStore } from './state';

export async function* publishDrafts(store: StateStore, publish: (d: Draft) => Promise<number>): AsyncGenerator<PublishResult> {
  const drafts = [...store.state.drafts].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
}
