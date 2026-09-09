import { useEffect } from 'react';
export function Overlay({ onClose, children, className = '' }: { onClose: () => void; children: React.ReactNode; className?: string }) {
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className={`sheet ${className}`} role="dialog">{children}</div></div>;
}
