import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PrInfo } from '@criever/shared';
import { api } from './api';
import { useStore, type Range } from './store';
export const usePr = () => useQuery({ queryKey: ['pr'], queryFn: api.pr });
export const useFiles = () => {
  const r = useStore(s => s.range);
  return useQuery({ queryKey: ['files', r?.base ?? null, r?.head ?? null], queryFn: () => api.files({ base: r?.base, head: r?.head }) });
};
/** Comment anchors are computed against the review's head, so they only line up while the range
 *  ends there. Browsing an older commit is read-only rather than showing cards on wrong lines. */
export const useRangeReadOnly = () => { const pr = usePr().data; const range = useStore(s => s.range); return !!range && !!pr && range.head !== pr.sourceHead; };
export const useRangeHasLocalOnly = () => {
  const pr = usePr().data; const range = useStore(s => s.range);
  if (!pr) return false;
  if (!range) return pr.commits.some(commit => commit.localOnly === true);
  return rangeContainsLocalOnly(pr, range);
};
const rangeContainsLocalOnly = (pr: PrInfo, range: Range) => {
  const start = pr.commits.findIndex(commit => commit.hash === range.head);
  const end = pr.commits.findIndex((_, index) => (pr.commits[index + 1]?.hash ?? pr.mergeBase) === range.base);
  return start >= 0 && end >= start && pr.commits.slice(start, end + 1).some(commit => commit.localOnly === true);
};
export const useComments = () => {
  const local = usePr().data?.kind === 'local';
  // Polling is the lazy correct choice at this scale while a local review is open (a
  // Bitbucket PR doesn't change under you the same way); a file-watch + SSE push is the upgrade
  // if this ever feels slow.
  return useQuery({ queryKey: ['comments'], queryFn: api.comments, refetchInterval: local ? 4000 : false });
};
export const useTree = (at: string | null) => useQuery({ queryKey: ['tree', at], queryFn: () => api.tree(at) });
export const useDiff = (path: string | null, o: { base?: string | null; head?: string | null; context?: number }) =>
  // keepPreviousData scoped to the same path: reusing another file's rows while this one loads would show
  // stale gutter rows under the new file's row testids (React reconciles by index across differently-shaped diffs).
  useQuery({ queryKey: ['diff', path, o.base ?? null, o.head ?? null, o.context ?? 3], queryFn: () => api.diff(path!, o), enabled: !!path, placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === path ? prev : undefined) });
export const useFile = (path: string | null, at: string | null) =>
  useQuery({ queryKey: ['file', path, at], queryFn: () => api.file(path!, at), enabled: !!path });
export const useSearch = (q: string) => useQuery({ queryKey: ['search', q], queryFn: () => api.search(q), enabled: q.trim().length > 1 });
export function useInvalidate() {
  const qc = useQueryClient();
  return () => { void qc.invalidateQueries({ queryKey: ['files'] }); void qc.invalidateQueries({ queryKey: ['comments'] }); void qc.invalidateQueries({ queryKey: ['pr'] }); };
}
