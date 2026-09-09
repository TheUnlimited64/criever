import { useEffect, useRef, useState } from 'react';
import { usePr } from '../hooks';
import type { ComposerTarget } from '../store';
import { applyFormat, type FormatKind } from './format';
import { flavorForProviderKind, markdownWarnings, renderMarkdown } from './markdown';

const FMT_SHORTCUT: Record<string, FormatKind> = { b: 'bold', i: 'italic', e: 'code', k: 'link' };
const FMT_BUTTONS: { kind: FormatKind; testid: string; title: string; content: React.ReactNode }[] = [
  { kind: 'bold', testid: 'composer/fmt/bold', title: 'Bold (⌘B)', content: <b>B</b> },
  { kind: 'italic', testid: 'composer/fmt/italic', title: 'Italic (⌘I)', content: <i>I</i> },
  { kind: 'code', testid: 'composer/fmt/code', title: 'Inline code (⌘E)', content: <code>`</code> },
  { kind: 'codeblock', testid: 'composer/fmt/codeblock', title: 'Code block', content: <code>```</code> },
  { kind: 'link', testid: 'composer/fmt/link', title: 'Link (⌘K)', content: 'Link' },
  { kind: 'quote', testid: 'composer/fmt/quote', title: 'Quote', content: '>' },
];

export function Composer({ target, initial = '', onSave, onCancel, placeholder }: { target: ComposerTarget; initial?: string; onSave: (body: string) => Promise<void>; onCancel: () => void; placeholder?: string }) {
  const [v, setV] = useState(initial); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const flavor = flavorForProviderKind(usePr().data?.kind ?? 'local');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const save = async () => { if (!v.trim() || busy) return; setBusy(true); setErr(null); try { await onSave(v); } catch (e) { setErr((e as Error).message); setBusy(false); } };
  // execCommand keeps the transformation on the browser's native undo stack (Ctrl+Z survives);
  // direct value assignment is a fallback for browsers without it, with no undo guarantee.
  const format = (kind: FormatKind) => {
    const el = ref.current; if (!el) return;
    const r = applyFormat(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0, kind);
    el.focus();
    el.setSelectionRange(0, el.value.length);
    let applied = false;
    if (typeof document.execCommand === 'function') { try { applied = document.execCommand('insertText', false, r.value); } catch { applied = false; } }
    if (!applied) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(el, r.value); else el.value = r.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.setSelectionRange(r.selStart, r.selEnd);
  };
  const where = target.parentId ? 'Reply to this thread' : target.endLine && target.endLine !== target.line ? `Comment on lines ${Math.min(target.line, target.endLine)}–${Math.max(target.line, target.endLine)}` : `Comment on line ${target.line}${target.side === 'old' ? ' (removed)' : ''}`;
  return (
    <div className="card draft composer" data-testid="composer">
      {mode === 'write'
        ? <>
            <div className="fmtbar">
              {FMT_BUTTONS.map(b => <button key={b.kind} type="button" className="btn sm ghost" data-testid={b.testid} title={b.title}
                onMouseDown={e => e.preventDefault()} onClick={() => format(b.kind)}>{b.content}</button>)}
            </div>
            <textarea ref={ref} data-testid="composer/text" value={v} onChange={e => setV(e.target.value)} placeholder={placeholder ?? `${where}. Markdown, rendered by Bitbucket.`}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void save(); }
                if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
                if (e.metaKey || e.ctrlKey) { const kind = FMT_SHORTCUT[e.key.toLowerCase()]; if (kind) { e.preventDefault(); e.stopPropagation(); format(kind); } }
              }} />
          </>
        : <div className="preview" data-testid="composer/preview">
            {markdownWarnings(v, flavor).map(w => <div key={w} className="chip amber previewWarning" data-testid="composer/previewWarning">{w}</div>)}
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(v, flavor) }} />
          </div>}
      <div className="card-ft">
        <span className="seg">
          <button className={mode === 'write' ? 'on' : ''} data-testid="composer/modeWrite" onClick={() => setMode('write')}>Write</button>
          <button className={mode === 'preview' ? 'on' : ''} data-testid="composer/modePreview" onClick={() => setMode('preview')}>Preview</button>
        </span>
        <span className="hint">{where} · ⌘↩ save · Esc cancel</span>{err && <span className="chip amber" data-testid="composer/error">{err}</span>}<span className="grow" />
        <button className="btn sm ghost" data-testid="composer/cancel" onClick={onCancel}>Cancel</button>
        <button className="btn sm primary" data-testid="composer/save" disabled={!v.trim() || busy} onClick={save}>{target.parentId ? 'Save draft reply' : 'Save draft'}</button></div>
    </div>
  );
}
