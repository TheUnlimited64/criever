export type Action = 'palette' | 'search' | 'find' | 'nextFile' | 'prevFile' | 'nextHunk' | 'prevHunk' | 'nextThread' | 'prevThread' | 'nextLine' | 'prevLine' | 'comment' | 'viewed' | 'vscode' | 'split' | 'resolve' | 'publish' | 'keys' | 'overview' | 'escape';
type E = { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; target?: { tagName?: string } | null };
const PLAIN: Record<string, Action> = { ']': 'nextFile', '[': 'prevFile', j: 'nextHunk', k: 'prevHunk', n: 'nextThread', p: 'prevThread', c: 'comment', v: 'viewed', '.': 'vscode', u: 'split', r: 'resolve', '?': 'keys', o: 'overview', ArrowDown: 'nextLine', ArrowUp: 'prevLine' };
export function matchKey(e: E): Action | null {
  const mod = e.metaKey || e.ctrlKey; const tag = e.target?.tagName ?? '';
  const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if (e.key === 'Escape') return 'escape';
  if (mod && e.shiftKey && e.key.toLowerCase() === 'f') return 'search';
  if (mod && e.key.toLowerCase() === 'k') return 'palette';
  if (mod && e.key.toLowerCase() === 'f') return 'find';
  if (mod && e.key === 'Enter') return 'publish';
  if (inField || mod || e.altKey) return null;
  return PLAIN[e.key] ?? null;
}
export function installKeys(dispatch: (a: Action) => void): () => void {
  // KeyboardEvent's key/modifier props are prototype getters, so `{...e}` (object spread) silently
  // drops them — matchKey needs them read out explicitly.
  const h = (e: KeyboardEvent) => {
    const a = matchKey({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, target: e.target as HTMLElement });
    if (a) { if (a !== 'escape') e.preventDefault(); dispatch(a); }
  };
  window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
}
