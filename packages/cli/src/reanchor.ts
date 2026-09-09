import type { AnchorStatus, Hunk } from '@criever/shared';

/**
 * Maps a 1-based line number on the OLD side of `hunks` (a `git diff -U0 anchor..head` for one file)
 * to its status on the NEW side.
 */
export function reanchor(line: number, hunks: Hunk[]): AnchorStatus {
  let offset = 0;
  for (const h of hunks) {
    if (h.oldLen === 0) {
      // pure insertion: oldStart is the old line the insertion comes AFTER
      if (line <= h.oldStart) break;
      offset += h.newLen;
      continue;
    }
    if (line < h.oldStart) break;
    if (line >= h.oldStart + h.oldLen) { offset += h.newLen - h.oldLen; continue; }
    if (h.newLen === 0) return { status: 'deleted', nearestLine: Math.max(h.newStart, 1) };
    return { status: 'changed', newLine: h.newStart, hunk: h };
  }
  return offset === 0 ? { status: 'same' } : { status: 'moved', newLine: line + offset };
}
