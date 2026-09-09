import { useStore } from '../store';
export function Toast() { const t = useStore(s => s.toast); return t ? <div className="toast" role="status" data-testid="toast">{t}</div> : null; }
