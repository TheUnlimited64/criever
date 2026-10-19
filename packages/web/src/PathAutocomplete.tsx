import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { workspaceApi } from './workspace-api';

export function PathAutocomplete({ value, onChange, disabled }: {
  readonly value: string;
  readonly onChange: (path: string) => void;
  readonly disabled: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState(-1);
  const suggestions = useQuery({
    queryKey: ['workspace-path-suggestions', value],
    queryFn: ({ signal }) => workspaceApi.suggestFolders(value, signal),
    enabled: open && !disabled, staleTime: 5000, refetchOnWindowFocus: false,
  });
  const folders = suggestions.data?.folders ?? [];
  const expanded = open && !disabled;
  const activeFolder = folders[active];
  const choose = (path: string) => {
    onChange(`${path}${path.endsWith(suggestions.data?.separator ?? '/') ? '' : suggestions.data?.separator ?? '/'}`);
    setOpen(false); setActive(-1); input.current?.focus();
  };
  useEffect(() => {
    if (active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, id]);
  return <div className="path-autocomplete">
    <label htmlFor={`${id}-input`}>Local repository path</label>
    <input id={`${id}-input`} ref={input} autoFocus required disabled={disabled}
      data-testid="workspace/project-path" role="combobox" aria-autocomplete="list"
      aria-expanded={expanded} aria-controls={expanded ? `${id}-list` : undefined}
      aria-activedescendant={expanded && activeFolder ? `${id}-option-${active}` : undefined}
      aria-describedby={`${id}-hint`} value={value} placeholder="~/projects/repository"
      autoComplete="off" spellCheck={false}
      onFocus={() => setOpen(true)}
      onBlur={event => { if (!event.currentTarget.form?.contains(event.relatedTarget)) setOpen(false); }}
      onChange={event => { onChange(event.target.value); setOpen(true); setActive(-1); }}
      onKeyDown={event => {
        if (event.key === 'Escape' && expanded) {
          event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1); return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true);
          setActive(index => folders.length === 0 ? -1 : event.key === 'ArrowDown'
            ? (index + 1) % folders.length : (index <= 0 ? folders.length : index) - 1);
        } else if ((event.key === 'Enter' || event.key === 'Tab') && expanded && activeFolder) {
          event.preventDefault(); choose(activeFolder.path);
        }
      }} />
    <small id={`${id}-hint`}>Type a path to see matching folders. Arrow keys choose; Enter or Tab completes. ~ is your home folder.</small>
    {expanded && <div className="path-suggestions">
      <div className="path-suggestion-heading">Folders on the daemon machine</div>
      {suggestions.isFetching && !suggestions.data && <p role="status">Finding folders...</p>}
      {suggestions.error && <p role="alert" className="path-error">{suggestions.error.message}</p>}
      {!suggestions.isFetching && !suggestions.error && folders.length === 0 && <p role="status">No matching folders. You can still enter a repository path directly.</p>}
      <ul id={`${id}-list`} role="listbox" aria-label="Folder suggestions">
        {!suggestions.error && folders.map((folder, index) => <li key={folder.path} id={`${id}-option-${index}`}
          role="option" aria-selected={active === index} className={active === index ? 'active' : ''}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(folder.path)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" /></svg>
          <span><strong>{folder.name}</strong><code>{folder.path}</code></span>
        </li>)}
      </ul>
    </div>}
  </div>;
}
