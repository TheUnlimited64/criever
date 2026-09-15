import type { Anchor, AnchorStatus, BbComment, Hunk, PrCommit, Thread } from '@criever/shared';
import { reanchor } from './reanchor';

export function inferAnchor(c: BbComment, commits: PrCommit[]): Anchor | null {
  if (!c.inline) return null;
  const side = c.inline.to == null && c.inline.from != null ? 'old' : 'new';
  const line = side === 'old' ? c.inline.from! : (c.inline.to ?? c.inline.from ?? 1);
  const sorted = commits.filter(commit => commit.localOnly !== true).sort((a, b) => a.date.localeCompare(b.date)); // oldest first
  if (sorted.length === 0) return null;
  const older = sorted.filter(k => k.date < c.createdOn);
  const anchorCommit = (older.at(-1) ?? sorted[0])?.hash ?? '';
  return { path: c.inline.path, line, side, anchorCommit, source: 'inferred' };
}

export type HunksFor = (anchorCommit: string, path: string) => Promise<{ hunks: Hunk[]; newPath: string | null } | 'fileDeleted'>;

function displayLine(a: Anchor, s: AnchorStatus): number | null {
  switch (s.status) {
    case 'same': return a.line;
    case 'moved': case 'changed': return s.newLine;
    case 'deleted': return s.nearestLine;
    case 'fileDeleted': return null;
  }
}

// Bitbucket threads nest arbitrarily deep: a reply's parentId can point at another reply,
// not just at the thread root. Walk the chain to find the true root so nothing gets grouped
// under a non-root id and silently dropped. Malformed data (a parent cycle, or a parent that
// isn't in the fetched page) must not hang or throw: the walk bails out and promotes the
// comment it got stuck on to its own root instead.
function resolveRootId(byId: Map<number, BbComment>, cache: Map<number, number>, start: BbComment): number {
  const cached = cache.get(start.id);
  if (cached != null) return cached;
  const seen = new Set<number>();
  let cur = start;
  while (cur.parentId != null && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = byId.get(cur.parentId);
    if (!parent) break;
    cur = parent;
  }
  const rootId = cur.id;
  for (const id of seen) cache.set(id, rootId);
  return rootId;
}

export async function buildThreads(comments: BbComment[], anchors: Record<number, Anchor>, commits: PrCommit[], hunksFor: HunksFor) {
  const newAnchors: Record<number, Anchor> = {};
  const byId = new Map(comments.map(c => [c.id, c]));
  const rootIdCache = new Map<number, number>();
  const replies = new Map<number, BbComment[]>();
  for (const c of comments) {
    if (c.deleted) continue;
    const rootId = resolveRootId(byId, rootIdCache, c);
    if (rootId === c.id) continue;
    (replies.get(rootId) ?? replies.set(rootId, []).get(rootId)!).push(c);
  }
  const roots = comments.filter(c => !c.deleted && resolveRootId(byId, rootIdCache, c) === c.id).sort((a, b) => a.createdOn.localeCompare(b.createdOn));

  // One `git diff` spawn per anchored comment (via hunksFor) — independent of every other root,
  // so run them concurrently rather than one at a time. Sequential awaits here made every
  // /api/comments and /api/files request (files() awaits comments()) pay the full sum of those
  // spawns, growing linearly with anchored-comment count. Comments cluster on the same file at
  // the same anchor, so memoising per call collapses that fan-out to one spawn per distinct
  // (anchorCommit, path) — which also bounds how many run at once. The map is per invocation:
  // head moves between requests, so caching across them would serve a stale diff.
  const hunkCache = new Map<string, ReturnType<HunksFor>>();
  const hunks: HunksFor = (anchorCommit, path) => {
    const key = `${anchorCommit}\0${path}`;
    let p = hunkCache.get(key);
    if (!p) { p = hunksFor(anchorCommit, path); hunkCache.set(key, p); }
    return p;
  };
  const threads = await Promise.all(roots.map(async root => {
    let anchor: Anchor | null = anchors[root.id] ?? null;
    if (!anchor && root.inline) { anchor = inferAnchor(root, commits); if (anchor) newAnchors[root.id] = anchor; }
    let status: AnchorStatus | null = null; let path = anchor?.path ?? null;
    if (anchor) {
      // No anchorCommit (or a git call against it failing) must never take the whole endpoint
      // down: degrade this one comment to "same" rather than diffing an empty/bad revision.
      if (!anchor.anchorCommit || anchor.side === 'old') status = { status: 'same' };
      else {
        try {
          const r = await hunks(anchor.anchorCommit, anchor.path);
          if (r === 'fileDeleted') status = { status: 'fileDeleted' };
          else { status = reanchor(anchor.line, r.hunks); if (r.newPath) path = r.newPath; }
        } catch {
          status = { status: 'same' };
        }
      }
    }
    return {
      root, replies: (replies.get(root.id) ?? []).sort((a, b) => a.createdOn.localeCompare(b.createdOn)),
      anchor, status, displayPath: path, displaySide: anchor?.side ?? 'new',
      displayLine: anchor && status ? displayLine(anchor, status) : null,
    };
  }));
  return { threads, newAnchors };
}
