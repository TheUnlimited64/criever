import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WorkspaceProject, WorkspacePullRequest } from '@criever/shared';
import { App } from './App';
import { Overlay } from './components/Overlay';
import { projectHref, useWorkspace, workspaceApi, workspaceKey } from './workspace-api';
import './workspace.css';
import { FolderPicker } from './FolderPicker';

const date = (iso: string | null) => {
  if (!iso) return 'Not synced yet';
  const value = new Date(iso);
  return Number.isNaN(+value) ? 'Unknown time' : value.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const statusLabels = { unreviewed: 'Not reviewed', reviewed: 'Reviewed', updated: 'Updated since review' } as const;
type Entry = { readonly project: WorkspaceProject; readonly pr: WorkspacePullRequest };

export function WorkspaceError({ error, retry }: { readonly error: Error; readonly retry: () => void }) {
  return <div className="desk-error" role="alert"><span>{error.message}</span><button type="button" className="btn sm" onClick={retry}>Retry</button></div>;
}

export function DeskNav({ project }: { readonly project?: WorkspaceProject }) {
  return <nav className="desk-nav" aria-label="Workspace navigation">
    <a className="brand" href="/">Criever<span className="desk-nav-label">Review desk</span></a>
    <span aria-hidden="true">/</span>
    <a href="/" aria-current={!project ? 'page' : undefined}>Projects</a>
    {project && <><span aria-hidden="true">/</span><span className="desk-crumb" aria-current="page" title={project.name}>{project.name}</span></>}
    <span className="desk-local">Local workspace</span>
  </nav>;
}

function PrList({ entries, busy, open, mark, empty }: {
  readonly entries: readonly Entry[]; readonly busy: boolean;
  readonly open: (entry: Entry) => void; readonly mark: (entry: Entry) => void; readonly empty: string;
}) {
  return <div className="desk-list">
    {entries.length === 0 && <div className="desk-empty"><p>{empty}</p></div>}
    {entries.map(entry => {
      const { project, pr } = entry;
      return <article className="desk-pr" key={`${project.id}/${pr.id}`} data-testid={`pr/${pr.id}`}>
        <div className="desk-pr-identity">
          <div className="desk-meta"><a href={projectHref(project.id)}>{project.name}</a><span>#{pr.id}</span><span>{pr.author}</span>{pr.draft && <span className="chip grey">Draft</span>}</div>
          <button className="desk-pr-title" data-testid={`pr/${pr.id}/open`} disabled={busy} onClick={() => open(entry)}>{pr.title}</button>
          <div className="desk-meta desk-branches"><code title={pr.sourceBranch}>{pr.sourceBranch}</code><span aria-hidden="true">→</span><code title={pr.destinationBranch}>{pr.destinationBranch}</code><span>Updated {date(pr.updatedAt)}</span></div>
        </div>
        <div className="desk-pr-state">
          <span className={`chip ${pr.status === 'updated' ? 'amber' : pr.status === 'reviewed' ? 'grey' : 'blue'}`} data-testid={`pr/${pr.id}/status`}>{statusLabels[pr.status]}</span>
          {pr.assignedToMe && <span className="desk-meta">Assigned to you</span>}
        </div>
        <div className="desk-row-actions">
          <button className="btn sm" data-testid={`pr/${pr.id}/reviewed`} disabled={busy} title="Local tracking only; does not approve on the provider" onClick={() => mark(entry)}>{pr.status === 'reviewed' ? 'Clear reviewed' : 'Mark reviewed'}</button>
          <a className="btn sm ghost" href={pr.url} target="_blank" rel="noreferrer" aria-label={`Open PR #${pr.id} on provider`}>Provider ↗</a>
        </div>
      </article>;
    })}
  </div>;
}

export function Workspace() {
  const query = useWorkspace(); const qc = useQueryClient();
  const match = window.location.pathname.match(/^\/projects\/([^/]+)\/?$/);
  const projectId = match ? decodeURIComponent(match[1] ?? '') : null;
  const projects = query.data?.projects ?? [];
  const project = projects.find(p => p.id === projectId);
  const [addOpen, setAddOpen] = useState(false);
  const [path, setPath] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [checkout, setCheckout] = useState<Entry | null>(null);
  const [remove, setRemove] = useState<WorkspaceProject | null>(null);
  const [filter, setFilter] = useState<'all' | 'assigned' | 'updated'>(projectId ? 'all' : 'updated');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ error: Error; retry: () => Promise<void> } | null>(null);
  const [notice, setNotice] = useState('');

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setFailure(null); setNotice('');
    try { await action(); }
    catch (error) { setFailure({ error: error instanceof Error ? error : new Error(String(error)), retry: () => run(action) }); }
    finally { setBusy(false); }
  };
  const updateProject = (next: WorkspaceProject) => {
    qc.setQueryData(workspaceKey, (old: typeof query.data) => old ? {
      ...old, projects: old.projects.some(p => p.id === next.id)
        ? old.projects.map(p => p.id === next.id ? next : p) : [...old.projects, next],
    } : old);
  };
  const refresh = () => run(async () => {
    if (project) {
      const next = await workspaceApi.refreshProject(project.id);
      updateProject(next);
      setNotice(next.error ? 'Sync failed. Showing the last successful results.' : 'Project refreshed.');
    } else {
      const next = await workspaceApi.refresh();
      qc.setQueryData(workspaceKey, next);
      setNotice(next.projects.some(p => p.error) ? 'Some projects could not sync. Their last successful results are shown.' : 'Workspace refreshed.');
    }
  });
  const mark = (entry: Entry) => void run(async () => {
    updateProject(await workspaceApi.reviewed(entry.project.id, entry.pr.id, entry.pr.status === 'reviewed' ? null : entry.pr.sourceHead));
    setNotice(entry.pr.status === 'reviewed' ? 'Local review marker cleared.' : 'Marked reviewed locally. No provider approval was sent.');
  });
  const entries = (project ? [project] : projects).flatMap(p => p.pullRequests.map(pr => ({ project: p, pr })));
  const assigned = entries.filter(e => e.pr.assignedToMe);
  const updated = entries.filter(e => e.pr.status === 'updated');
  const visible = filter === 'assigned' ? assigned : filter === 'updated' ? updated : entries;
  const closeDialog = () => { if (!busy) { setAddOpen(false); setBrowsing(false); setCheckout(null); setRemove(null); setFailure(null); } };
  const errorSurface = failure && <WorkspaceError error={failure.error} retry={() => { void failure.retry(); }} />;

  if (query.data === null) return <App />;
  if (!query.data) return <div className="desk-shell"><DeskNav /><main className="desk-scroll"><div className="desk-content">
    <h1>Review desk</h1>{query.error ? <WorkspaceError error={query.error} retry={() => { void query.refetch(); }} /> : <p role="status">Loading your projects…</p>}
  </div></main></div>;

  return <div className="desk-shell">
    <DeskNav project={project} />
    <main className="desk-scroll" data-testid="workspace">
      <div className="desk-content">
        <header className="desk-heading">
          <div><div className="desk-eyebrow">{project ? `${project.provider} · ${project.owner} / ${project.repo}` : 'Your workspace'}</div><h1>{project ? project.name : 'Review desk'}</h1>
            <p>{project ? 'Open pull requests. Keep track of what you have reviewed on this machine.' : 'Pick up where you left off. New commits first, repositories within reach.'}</p>
            {project && <code className="desk-path" title={project.path}>{project.path}</code>}
          </div>
          <div className="desk-actions"><button className="btn" data-testid="workspace/refresh" disabled={busy} onClick={() => { void refresh(); }}>{busy ? 'Working…' : 'Refresh'}</button>
            {!projectId && <button className="btn primary" data-testid="workspace/add-project" onClick={() => { setFailure(null); setAddOpen(true); }}>Add project</button>}
          </div>
        </header>
        <div className="desk-feedback" role="status">{notice}</div>
        {query.error && <WorkspaceError error={query.error} retry={() => { void query.refetch(); }} />}
        {!addOpen && !checkout && !remove && errorSurface}
        {projectId && !project && <section className="desk-section"><div className="desk-empty"><h2>Project unavailable</h2><p>It may have been removed from this workspace.</p><a className="btn" href="/">Back to Projects</a></div></section>}
        {project?.error && <div className="desk-error" role="alert"><span>{project.error}</span><button className="btn sm" disabled={busy} onClick={() => { void refresh(); }}>Retry sync</button></div>}
        {(!projectId || project) && <>
          <div className="desk-summary" aria-label="Review summary">
            <button data-testid="workspace/summary-updates" aria-pressed={filter === 'updated'} onClick={() => setFilter('updated')}><strong>{updated.length}</strong><span>Updates since your review</span><small>Revisit changed pull requests</small></button>
            <button aria-pressed={filter === 'assigned'} onClick={() => setFilter('assigned')}><strong>{assigned.length}</strong><span>Assigned to me</span><small>Your review queue</small></button>
            <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}><strong>{entries.length}</strong><span>Open pull requests</span><small>{project ? 'Across this project' : `Across ${projects.length} projects`}</small></button>
          </div>
          {!projectId && <section className="desk-section" aria-labelledby="projects-title">
            <div className="desk-section-head"><h2 id="projects-title">Projects <span>{projects.length}</span></h2><span className="desk-meta">Local repositories</span></div>
            <div className="desk-list">
              {projects.length === 0 && <div className="desk-empty"><h3>Make room for your next review</h3><p>Add a local repository to see its open pull requests, assignments, and updates since your review.</p><button className="btn primary" onClick={() => setAddOpen(true)}>Add your first project</button></div>}
              {projects.map(p => <div className="desk-project" key={p.id}>
                <div><a className="desk-project-name" data-testid={`project/${p.id}`} href={projectHref(p.id)}>{p.name}<span aria-hidden="true">↗</span></a><div className="desk-meta">{p.provider} · {p.owner} / {p.repo}</div><code className="desk-path" title={p.path}>{p.path}</code>
                  {p.error && <div className="desk-project-error" role="alert">{p.error}<button className="btn sm" disabled={busy} onClick={() => { void run(async () => updateProject(await workspaceApi.refreshProject(p.id))); }}>Retry sync</button></div>}
                </div>
                <div className="desk-project-counts"><span>{p.pullRequests.length} open</span><span>{p.pullRequests.filter(pr => pr.assignedToMe).length} assigned</span><span className="desk-meta">Synced {date(p.refreshedAt)}</span></div>
                <button className="btn sm ghost" data-testid={`project/${p.id}/remove`} disabled={busy} aria-label={`Remove ${p.name} from workspace`} onClick={() => { setFailure(null); setRemove(p); }}>Remove</button>
              </div>)}
            </div>
          </section>}
          <section className="desk-section" data-testid={filter === 'updated' ? 'workspace/updates' : 'workspace/pull-requests'} aria-labelledby="prs-title">
            <div className="desk-section-head"><h2 id="prs-title">{filter === 'updated' ? 'Updates since your review' : filter === 'assigned' ? 'Assigned to me' : 'Open pull requests'} <span>{visible.length}</span></h2>
              <div className="seg" aria-label="Filter pull requests">
                <button className={filter === 'all' ? 'on' : ''} aria-pressed={filter === 'all'} data-testid="workspace/filter/all" onClick={() => setFilter('all')}>All open</button>
                <button className={filter === 'assigned' ? 'on' : ''} aria-pressed={filter === 'assigned'} data-testid="workspace/assigned" onClick={() => setFilter('assigned')}>Assigned to me</button>
                <button className={filter === 'updated' ? 'on' : ''} aria-pressed={filter === 'updated'} data-testid="workspace/filter/updated" onClick={() => setFilter('updated')}>Updated</button>
              </div>
            </div>
            <PrList entries={visible} busy={busy} open={entry => { setFailure(null); setCheckout(entry); }} mark={mark}
              empty={filter === 'updated' ? 'You are caught up. No new commits since your local reviews.' : filter === 'assigned' ? 'No open pull requests are assigned to you.' : 'No open pull requests in this project yet.'} />
          </section>
          <p className="desk-footnote">Review markers stay on this machine. They do not approve or change pull requests on your provider.</p>
        </>}
      </div>
    </main>
    {addOpen && <Overlay label="Add project" onClose={closeDialog}>
      <form onSubmit={e => { e.preventDefault(); void run(async () => { updateProject(await workspaceApi.add(path.trim())); setAddOpen(false); setPath(''); setNotice('Project added.'); }); }}>
        <div className="sheet-hd">Add a local project</div><div className="desk-form">
          <p>Choose a repository already on this machine. Criever will discover its provider and open pull requests.</p>
          {browsing ? <FolderPicker initialPath={path} onChoose={next => { setPath(next); setBrowsing(false); }} onCancel={() => setBrowsing(false)} /> : <>
            <label htmlFor="project-path">Local repository path</label>
            <div className="folder-location"><input id="project-path" data-testid="workspace/project-path" autoFocus required value={path} onChange={e => setPath(e.target.value)} placeholder="~/projects/repository" aria-describedby="project-path-hint" />
              <button type="button" className="btn" data-testid="workspace/browse" disabled={busy} onClick={() => setBrowsing(true)}>Browse folders</button></div>
            <small id="project-path-hint">Choose a folder or enter a path. ~ refers to the daemon user's home directory.</small>
          </>}{errorSurface}
        </div>
        {!browsing && <div className="sheet-ft"><span className="grow" /><button className="btn" type="button" disabled={busy} onClick={closeDialog}>Cancel</button><button className="btn primary" data-testid="workspace/project-submit" disabled={busy || !path.trim()}>{busy ? 'Adding…' : 'Add project'}</button></div>}
      </form>
    </Overlay>}
    {checkout && <Overlay label="Prepare a local checkout" onClose={closeDialog}>
      <div className="sheet-hd">Prepare a local checkout?</div><div className="desk-form">
        <strong>#{checkout.pr.id} · {checkout.pr.title}</strong><p>Criever needs to prepare a local checkout of this pull request before you can review its files.</p>
        <code className="desk-path">{checkout.project.path}</code><p className="desk-meta">Branch {checkout.pr.sourceBranch} · head {checkout.pr.sourceHead.slice(0, 7)}</p>{errorSurface}
      </div>
      <div className="sheet-ft"><span className="grow">No checkout is prepared if you cancel.</span><button className="btn" data-testid="workspace/checkout-cancel" disabled={busy} onClick={closeDialog}>Cancel</button>
        <button className="btn primary" data-testid="workspace/checkout-confirm" disabled={busy} onClick={() => { void run(async () => { const session = await workspaceApi.checkout(checkout.project.id, checkout.pr.id); window.location.assign(session.url); }); }}>{busy ? 'Preparing…' : 'Yes, prepare checkout'}</button></div>
    </Overlay>}
    {remove && <Overlay label="Remove project" onClose={closeDialog}><div className="sheet-hd">Remove {remove.name}?</div><div className="desk-form"><p>Remove this project from the review desk. Its repository files remain on disk.</p>{errorSurface}</div>
      <div className="sheet-ft"><span className="grow" /><button className="btn" disabled={busy} onClick={closeDialog}>Cancel</button><button className="btn primary" disabled={busy} onClick={() => { void run(async () => {
        await workspaceApi.remove(remove.id); qc.setQueryData(workspaceKey, (old: typeof query.data) => old ? { ...old, projects: old.projects.filter(p => p.id !== remove.id) } : old); setRemove(null); setNotice('Project removed from workspace.');
      }); }}>Remove project</button></div></Overlay>}
  </div>;
}
