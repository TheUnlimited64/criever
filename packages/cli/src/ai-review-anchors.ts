import type { Side } from '@criever/shared';
import { ReviewProtocolError } from './ai-review-protocol';
import type { AnchorContext } from './ai-review-types';

export async function anchorPath(anchor: AnchorContext, path: string, line: number, side: Side): Promise<string> {
  const normalized = anchor.renames.get(path) ?? path;
  const oldPath = anchor.changedFiles.find(file => file.status === 'R' && file.newPath === normalized)?.oldPath ?? path;
  const matches = [path, normalized].some(candidate => anchor.anchors.has(`${candidate}\0${side}\0${line}`));
  if (!matches) throw new ReviewProtocolError(422, `invalid changed-line anchor ${path}:${line} (${side})`);
  const blob = await anchor.git.show(side === 'old' ? anchor.base : anchor.head, side === 'old' ? oldPath : normalized);
  const lines = blob === null ? 0 : blob.split('\n').length - Number(blob.endsWith('\n'));
  if (line > lines) throw new ReviewProtocolError(422, `anchor is outside ${side} revision: ${path}:${line}`);
  return normalized;
}
