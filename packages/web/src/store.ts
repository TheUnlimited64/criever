import { create } from 'zustand';
import type { Side } from '@criever/shared';

export type Overlay = null | 'publish' | 'palette' | 'search' | 'keys' | 'find' | 'overview';
/** A commit range the whole review is scoped to. null means the review's own mergeBase..sourceHead. */
export interface Range { base: string; head: string }
export interface ComposerTarget { path: string; line: number; side: Side; endLine?: number; parentId?: number }
const ls = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };

interface S {
  currentPath: string | null; setCurrentPath: (p: string | null) => void;
  viewMode: 'diff' | 'file'; fileAt: string | null;
  range: Range | null; setRange: (r: Range | null) => void;
  openDiff: (path: string) => void; openFile: (path: string, at?: string | null, line?: number) => void;
  jumpLine: number | null;
  split: boolean; toggleSplit: () => void;
  context: number; setContext: (n: number) => void;
  overlay: Overlay; setOverlay: (o: Overlay) => void;
  composer: ComposerTarget | null; setComposer: (c: ComposerTarget | null) => void;
  selection: { side: Side; from: number; to: number } | null; setSelection: (sel: { side: Side; from: number; to: number } | null) => void;
  focusedThread: number | null; setFocusedThread: (id: number | null) => void;
  toast: string | null; showToast: (m: string) => void;
  showAll: boolean; setShowAll: (b: boolean) => void;
  cursor: { side: Side; line: number } | null; setCursor: (c: { side: Side; line: number } | null) => void;
}
export const useStore = create<S>((set) => ({
  currentPath: null, setCurrentPath: p => set({ currentPath: p }),
  viewMode: 'diff', fileAt: null, jumpLine: null,
  range: null, setRange: r => set({ range: r, selection: null, composer: null }),
  openDiff: path => set({ currentPath: path, viewMode: 'diff', jumpLine: null, context: 3, selection: null, composer: null }),
  openFile: (path, at = null, line) => set({ currentPath: path, viewMode: 'file', fileAt: at, jumpLine: line ?? null, selection: null, composer: null }),
  split: ls('criever.split', '0') === '1',
  toggleSplit: () => set(s => { try { localStorage.setItem('criever.split', s.split ? '0' : '1'); } catch {} return { split: !s.split }; }),
  context: 3, setContext: n => set({ context: n }),
  overlay: null, setOverlay: o => set({ overlay: o }),
  composer: null, setComposer: c => set({ composer: c }),
  selection: null, setSelection: sel => set({ selection: sel }),
  focusedThread: null, setFocusedThread: id => set({ focusedThread: id }),
  toast: null, showToast: m => { set({ toast: m }); setTimeout(() => set(s => (s.toast === m ? { toast: null } : {})), 2200); },
  showAll: false, setShowAll: b => set({ showAll: b }),
  cursor: null, setCursor: c => set({ cursor: c }),
}));
