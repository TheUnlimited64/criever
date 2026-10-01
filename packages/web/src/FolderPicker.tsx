import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { workspaceApi } from './workspace-api';

export function FolderPicker({ initialPath, onChoose, onCancel }: {
  readonly initialPath: string;
  readonly onChoose: (path: string) => void;
  readonly onCancel: () => void;
}) {
  const [path, setPath] = useState(initialPath.trim() || '~');
  const [location, setLocation] = useState(initialPath.trim() || '~');
  const locationInput = useRef<HTMLInputElement>(null);
  const query = useQuery({
    queryKey: ['workspace-folders', path], queryFn: () => workspaceApi.folders(path),
    staleTime: 0, refetchOnWindowFocus: false,
  });
  const go = (next: string) => { setPath(next); setLocation(next); locationInput.current?.focus(); };
  return <section className="folder-picker" aria-label="Browse folders">
    <p>Browse folders on the machine running Criever.</p>
    <label htmlFor="folder-location">Folder location</label>
    <div className="folder-location">
      <input id="folder-location" ref={locationInput} autoFocus value={location} onChange={e => setLocation(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (location.trim()) go(location.trim()); } }} />
      <button type="button" className="btn" disabled={!location.trim()} onClick={() => go(location.trim())}>Go</button>
    </div>
    <div className="folder-toolbar">
      <button type="button" className="btn sm" onClick={() => go('~')}>Home</button>
      <button type="button" className="btn sm" disabled={!query.data?.parentPath} onClick={() => { if (query.data?.parentPath) go(query.data.parentPath); }}>Up</button>
      {query.data && <code className="desk-path" data-testid="workspace/folder-current">{query.data.path}</code>}
    </div>
    {query.isFetching && <p role="status">Loading folders...</p>}
    {query.error && <div className="desk-error" role="alert"><span>{query.error.message}</span>
      <button type="button" className="btn sm" onClick={() => { void query.refetch(); }}>Retry</button>
    </div>}
    {query.data && !query.error && <div className="folder-list" aria-label="Folders" aria-busy={query.isFetching}>
      {query.data.folders.length === 0 && <p className="desk-meta">No subfolders. You can select this folder or go up.</p>}
      {query.data.folders.map(folder => <button type="button" className="folder-entry" key={folder.path}
        aria-label={`Open folder ${folder.name}`} onClick={() => go(folder.path)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" /></svg>
        <span>{folder.name}</span>
      </button>)}
    </div>}
    <div className="folder-actions">
      <button type="button" className="btn" onClick={onCancel}>Cancel browsing</button>
      <button type="button" className="btn primary" data-testid="workspace/folder-select" disabled={!query.data || query.isFetching || !!query.error}
        onClick={() => { if (query.data) onChoose(query.data.path); }}>Use this folder</button>
    </div>
  </section>;
}
