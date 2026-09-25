import { useEffect } from 'react';
import type { Side } from '@criever/shared';
import { api } from './api';
import { Header } from './components/Header';
import { FilesPane } from './components/FilesPane';
import { Keymap } from './components/Keymap';
import { ReviewCodePane } from './components/ReviewCodePane';
import { CommentsRail } from './components/CommentsRail';
import { AiRail } from './components/AiRail';
import { Footer } from './components/Footer';
import { Toast } from './components/Toast';
import { PublishSheet } from './components/PublishSheet';
import { FilePalette } from './components/FilePalette';
import { SearchDrawer } from './components/SearchDrawer';
import { Overview } from './components/Overview';
import { useComments, useFiles, useInvalidate, usePr } from './hooks';
import { installKeys } from './keys';
import { useStore } from './store';

function useKeyboard() {
  const s = useStore(); const files = useFiles().data ?? []; const c = useComments().data; const invalidate = useInvalidate(); const pr = usePr().data;
  useEffect(() => installKeys(async a => {
    const i = files.findIndex(f => f.path === s.currentPath);
    // The diff table for a just-opened file renders one tick after the click that switched files
    // (react-query fetch, then commit). Hunk/thread jumps right after a file switch would otherwise
    // race that render and silently find nothing; give it a few frames before reading the DOM.
    if ((a === 'nextHunk' || a === 'prevHunk' || a === 'nextThread' || a === 'prevThread') && s.viewMode === 'diff') {
      for (let n = 0; n < 15 && !document.querySelector('table.diff'); n++) await new Promise(r => requestAnimationFrame(r));
    }
    /** From the cursor row (or top), walk rows in direction d to the next element matching sel. For hunks, return the first code row after the header. */
    const jump = (sel: 'tr.hunk' | 'tr.thread' | 'tr.line', d: 1 | -1): HTMLElement | null => {
      const rows = [...document.querySelectorAll<HTMLElement>('table.diff tbody > tr')];
      const cur = document.querySelector<HTMLElement>('tr.cursor') ?? document.querySelector<HTMLElement>('.card.focused')?.closest<HTMLElement>('tr');
      const start = cur ? rows.indexOf(cur) : (d === 1 ? -1 : rows.length);
      for (let k = start + d; k >= 0 && k < rows.length; k += d) {
        if (!rows[k]!.matches(sel)) continue;
        const target = sel === 'tr.hunk' ? rows.slice(k + 1).find(r => r.matches('tr.line')) ?? null : rows[k]!;
        target?.scrollIntoView({ block: 'center' }); return target;
      }
      return null;
    };
    switch (a) {
      case 'palette': s.setOverlay('palette'); break;
      case 'search': s.setOverlay('search'); break;
      case 'find': s.setOverlay('find'); break;
      case 'keys': s.setOverlay('keys'); break;
      case 'overview': s.setOverlay('overview'); break;
      case 'publish': s.setOverlay('publish'); break;
      case 'escape': if (s.overlay) s.setOverlay(null); else if (s.composer) { s.setComposer(null); s.setSelection(null); } else s.setFocusedThread(null); break;
      case 'nextFile': if (files[i + 1]) s.openDiff(files[i + 1]!.path); break;
      case 'prevFile': if (files[i - 1]) s.openDiff(files[i - 1]!.path); break;
      case 'nextHunk': case 'prevHunk': { const row = jump('tr.hunk', a === 'nextHunk' ? 1 : -1); if (row?.dataset.line) s.setCursor({ side: row.dataset.side as Side, line: +row.dataset.line }); break; }
      case 'nextThread': case 'prevThread': { const row = jump('tr.thread', a === 'nextThread' ? 1 : -1); const id = row?.querySelector('[data-testid^="thread/"]')?.getAttribute('data-testid')?.split('/')[1]; if (id) s.setFocusedThread(+id); break; }
      case 'nextLine': case 'prevLine': { const row = jump('tr.line', a === 'nextLine' ? 1 : -1); if (row?.dataset.line) s.setCursor({ side: row.dataset.side as Side, line: +row.dataset.line }); break; }
      case 'comment': if (s.cursor && s.currentPath) { s.setSelection({ side: s.cursor.side, from: s.cursor.line, to: s.cursor.line }); s.setComposer({ path: s.currentPath, ...s.cursor }); } break;
      case 'viewed': { const f = files[i]; if (f) { await api.setViewed(f.path, !f.viewed); invalidate(); } break; }
      case 'split': s.toggleSplit(); break;
      case 'resolve': { const t = c?.threads.find(x => x.root.id === s.focusedThread); if (t && !t.root.resolved) { await api.resolve(t.root.id); invalidate(); } break; }
      case 'vscode': if (s.currentPath) { try { const { url } = await api.vscodeOpen(s.currentPath, s.cursor?.line ?? 1); window.open(url, 'criever-vscode'); } catch (e) { s.showToast((e as Error).message); } } break;
    }
  }), [s, files, c, invalidate, pr]);
}

export function App() {
  const files = useFiles(); const { currentPath, openDiff } = useStore();
  const overlay = useStore(s => s.overlay); const aiOpen = useStore(s => s.aiOpen);
  useEffect(() => { if (!currentPath && files.data?.[0]) openDiff(files.data[0].path); }, [files.data, currentPath, openDiff]);
  useKeyboard();
  return (
    <div className="app">
      <Header />
      <div className={`main${aiOpen ? ' ai-open' : ''}`}>
        <FilesPane />
        <ReviewCodePane />
        <div className="rail-slot" hidden={aiOpen}><CommentsRail /></div>
        <div className="rail-slot" hidden={!aiOpen}><AiRail /></div>
      </div>
      <Footer />
      <Toast />
      {overlay === 'publish' && <PublishSheet />}
      {overlay === 'keys' && <Keymap />}
      {overlay === 'palette' && <FilePalette />}
      {overlay === 'search' && <SearchDrawer />}
      {overlay === 'overview' && <Overview />}
    </div>
  );
}
