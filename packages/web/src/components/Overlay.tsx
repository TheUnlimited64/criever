import { useEffect, useRef } from 'react';
export function Overlay({ onClose, children, className = '', label = 'Review tools' }: { onClose: () => void; children: React.ReactNode; className?: string; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement);
  useEffect(() => {
    const dialog = ref.current; const previous = previousFocus.current;
    if (dialog && !dialog.contains(document.activeElement)) (dialog.querySelector<HTMLElement>('input, textarea, button') ?? dialog).focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key !== 'Tab') return;
      const controls = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select, textarea, [tabindex="0"]') ?? [])].filter(el => el.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && (document.activeElement === first || !ref.current?.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !ref.current?.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} className={`sheet ${className}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}><div className="sheet-close-row"><button className="btn sm ghost" aria-label={`Close ${label}`} onClick={onClose}>Close ×</button></div>{children}</div></div>;
}
