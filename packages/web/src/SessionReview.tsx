import { useState } from 'react';
import type { WorkspaceSession } from '@criever/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from './App';
import { usePr } from './hooks';
import { WorkspaceError } from './Workspace';
import { projectHref, useWorkspace, workspaceApi, workspaceKey } from './workspace-api';

export function SessionReview({ id }: { readonly id: string }) {
  const session = useQuery({ queryKey: ['workspace-session', id], queryFn: () => workspaceApi.session(id), refetchOnWindowFocus: false });
  if (!session.data) return <div className="desk-shell">
    <nav className="desk-nav" aria-label="Workspace navigation"><a className="brand" href="/">Criever</a><a href="/">Projects</a></nav>
    <main className="desk-scroll"><div className="desk-content">
      <h1>{session.error ? 'Review session unavailable' : 'Opening review session…'}</h1>
      {session.error && <><p>This session may be missing or stale. Return to your projects to prepare a new review.</p><WorkspaceError error={session.error} retry={() => { void session.refetch(); }} /><a className="btn" href="/">Return to review desk</a></>}
    </div></main>
  </div>;
  return <SessionContents session={session.data} />;
}

function SessionContents({ session }: { readonly session: WorkspaceSession }) {
  const prQuery = usePr(); const pr = prQuery.data;
  const workspace = useWorkspace(); const qc = useQueryClient();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<{ readonly error: Error; readonly head: string | null } | null>(null);
  const [markedHead, setMarkedHead] = useState<string | null>(null); const [notice, setNotice] = useState('');
  const project = workspace.data?.projects.find(p => p.id === session.projectId);
  const tracked = project?.pullRequests.find(p => p.id === session.prId);
  const sourceHead = pr?.sourceHead ?? session.sourceHead;
  const reviewed = (markedHead ?? tracked?.reviewedHead) === sourceHead;
  const mark = async (head: string | null) => {
    setBusy(true); setError(null);
    try {
      const next = await workspaceApi.reviewed(session.projectId, session.prId, head);
      qc.setQueryData(workspaceKey, (old: typeof workspace.data) => old ? { ...old, projects: old.projects.map(p => p.id === next.id ? next : p) } : old);
      setMarkedHead(head);
      setNotice(head ? `Marked ${head.slice(0, 7)} reviewed locally. No provider approval was sent.` : 'Local review marker cleared.');
    } catch (failure) { setError({ error: failure instanceof Error ? failure : new Error(String(failure)), head }); }
    finally { setBusy(false); }
  };
  const leave = (event: React.MouseEvent<HTMLAnchorElement>) => {
    const composerText = [...document.querySelectorAll<HTMLTextAreaElement>('.composer textarea')].some(input => input.value.trim().length > 0);
    if (composerText && !window.confirm('Leave this review? Unsaved composer text will be lost. Saved drafts will remain available.')) event.preventDefault();
  };
  return <div className="session-shell">
    <div className="session-top">
      <nav className="desk-nav" aria-label="Workspace navigation">
        <a className="brand" href="/" onClick={leave}>Criever</a><span aria-hidden="true">/</span><a href="/" onClick={leave}>Projects</a>
        <span aria-hidden="true">/</span><a className="desk-crumb" data-testid="workspace/back-project" href={projectHref(session.projectId)} onClick={leave}>Back to {project?.name ?? 'project'}</a>
        <span className="desk-crumb" aria-current="page">Review #{session.prId}</span>
        <div className="session-actions">
          <button className="btn sm" data-testid="workspace/session-reviewed" disabled={busy || !pr || reviewed} title="Local tracking only, not provider approval" onClick={() => { void mark(sourceHead); }}>{busy ? 'Saving…' : reviewed ? 'Reviewed locally' : 'Mark reviewed'}</button>
          {reviewed && <button className="btn sm ghost" data-testid="workspace/session-clear-reviewed" disabled={busy} onClick={() => { void mark(null); }}>Clear reviewed</button>}
        </div>
      </nav>
      <div className="session-message" role="status">{notice || `Review markers are local only · source ${sourceHead.slice(0, 7)}`}</div>
      {error && <WorkspaceError error={error.error} retry={() => { void mark(error.head); }} />}
      {prQuery.error && <WorkspaceError error={prQuery.error} retry={() => { void prQuery.refetch(); }} />}
      {workspace.error && <WorkspaceError error={workspace.error} retry={() => { void workspace.refetch(); }} />}
    </div>
    <App />
  </div>;
}
