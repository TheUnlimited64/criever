/** Pure "changed since" wording helpers, shared by the card chip and the rail group heading. */

export interface ChangedSinceAuthor { isMe: boolean; name: string }

function possessive(name: string): string | null {
  const first = name.trim().split(/\s+/)[0];
  if (!first) return null;
  return first.endsWith('s') ? `${first}'` : `${first}'s`;
}

/** "your comment" / "Tom's comment" / "Chris' comment" / "this comment" (no usable name). */
export function changedSinceLabel(author: ChangedSinceAuthor | null | undefined): string {
  if (!author) return 'this comment';
  if (author.isMe) return 'your comment';
  const p = possessive(author.name);
  return p ? `${p} comment` : 'this comment';
}

/** Chip text for a single thread's amber "changed" badge. */
export function changedSinceChip(author: ChangedSinceAuthor | null | undefined): string {
  return `changed since ${changedSinceLabel(author)}`;
}

/** Rail group heading for a set of "changed since" threads: names the author only when every
 *  thread in the group shares one, falls back to a neutral plural otherwise. */
export function changedSinceHeading(threads: { root: { author: ChangedSinceAuthor } }[]): string {
  if (threads.length === 0) return 'Changed since your comment';
  const first = threads[0]!.root.author;
  const sameAuthor = threads.every(t => t.root.author.isMe === first.isMe && (first.isMe || t.root.author.name === first.name));
  const label = sameAuthor ? changedSinceLabel(first) : 'these comments';
  return `Changed since ${label}`;
}
