import { useComments, useFiles, usePr, useInvalidate, useRangeReadOnly } from '../hooks';
import { api } from '../api';
import { useStore } from '../store';
import { shortcutLabel } from '../keys';

export function Header() {
  const review = usePr(); const pr = review.data; const comments = useComments().data;
  const drafts = comments?.drafts.length ?? 0; const files = useFiles().data ?? [];
  const { setOverlay, range, setRange, activePanel, setActivePanel } = useStore(); const invalidate = useInvalidate();
  const readOnly = useRangeReadOnly();
  if (!pr) return <header className="hdr" data-testid="header"><div className="workspace-bar"><strong className="brand">Criever</strong><span role="status">{review.error ? 'Review could not load' : 'Loading review workspace…'}</span></div></header>;
  const local = pr.kind === 'local';
  const newCommits = !local && pr.lastSeenHead && pr.lastSeenHead !== pr.sourceHead ? pr.commits.findIndex(c => c.hash === pr.lastSeenHead) : 0;
  const dismiss = async () => { await api.seen(); invalidate(); };
  return (
    <header className="hdr" data-testid="header">
      <div className="workspace-bar">
        <span className="brand"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m8 5-6 7 6 7M16 5l6 7-6 7M14 3l-4 18" /></svg>Criever</span>
        <span className="workspace-divider" aria-hidden="true">/</span>
        {!local && <span className="repo" data-testid="header/repo" title={pr.url ?? ''}>{pr.url?.replace(/^https?:\/\/bitbucket\.org\//, '').split('/pull-requests')[0]?.replace('/', ' / ')}</span>}
        <span className="workspace-kind">{local ? 'Local review' : 'Bitbucket review'}</span>
        <span className="workspace-note">{local ? 'Comments stay on this machine' : 'Drafts stay private until published'}</span>
      </div>
      <div className="review-bar">
        <div className="hdr-left">
          <div className="review-heading">
            {!local && <span className="prno" data-testid="header/prNumber">#{pr.id}</span>}
            <button className="title-btn" data-testid="header/overviewButton" title="Open review overview and select commits" onClick={() => setOverlay('overview')}>
              <span className="title" data-testid="header/title">{pr.title}</span>
            </button>
          </div>
          <button className="overview-link" onClick={() => setOverlay('overview')}>Overview &amp; {pr.commits.length} commit{pr.commits.length === 1 ? '' : 's'}</button>
        </div>
        <div className="review-actions">
          <span className="drafts" data-testid="header/draftCount">{drafts} draft{drafts === 1 ? '' : 's'}</span>
          <button className="btn primary" data-testid="header/publishButton" disabled={drafts === 0} title={local ? 'Save drafts as local review comments' : 'Review drafts before publishing to Bitbucket'} onClick={() => setOverlay('publish')}>{local ? 'Save' : 'Publish'}</button>
        </div>
      </div>
      <div className="comparison-bar" aria-label="Current comparison">
        <div className="comparison-context">
          <span className="comparison-label">{range ? 'Commit range' : 'Whole review'}</span>
          <span className="comparison-ref" title={range?.base ?? pr.mergeBase}><span>Base</span><code>{range ? range.base.slice(0, 7) : pr.destinationBranch}</code><span className="ref-hash">{!range && pr.mergeBase.slice(0, 7)}</span></span>
          <span className="comparison-arrow" aria-hidden="true">→</span>
          <span className="comparison-ref" title={range?.head ?? pr.sourceHead}><span>Head</span><code>{range ? range.head.slice(0, 7) : pr.sourceBranch}</code><span className="ref-hash">{!range && pr.sourceHead.slice(0, 7)}</span></span>
          {range && <span className="chip blue" data-testid="header/rangeChip">{range.base.slice(0, 7)}..{range.head.slice(0, 7)}{readOnly ? ' · read-only' : ''}<button data-testid="header/rangeChip/clear" aria-label="Back to the whole review" title="Back to the whole review" onClick={() => setRange(null)}>×</button></span>}
          {pr.localBehind > 0 && <span className="chip grey" data-testid="header/localBehind">checkout behind head by {pr.localBehind}</span>}
        </div>
        <nav className="review-tools" aria-label="Review tools">
          <button className="btn sm ghost" onClick={() => setOverlay('palette')}>Go to file <kbd>{shortcutLabel('K')}</kbd></button>
          <button className="btn sm ghost" onClick={() => setOverlay('search')}>Search</button>
          <button className="btn sm ghost" onClick={() => { setActivePanel('code'); setOverlay('find'); }}>Find in file</button>
          <button className="btn sm ghost" onClick={() => setOverlay('keys')}>Shortcuts <kbd>?</kbd></button>
        </nav>
      </div>
      <div className="review-notices">
        {!local && newCommits > 0 && (
          <span className="banner" data-testid="header/newCommitsBanner">{newCommits} new commit{newCommits > 1 ? 's' : ''} since your last visit
            <button data-testid="header/newCommitsBanner/showDiff" onClick={() => setRange({ base: pr.lastSeenHead!, head: pr.sourceHead })}>show diff</button>
            <button data-testid="header/newCommitsBanner/dismiss" onClick={dismiss} aria-label="Mark new commits as seen" title="Mark as seen">×</button>
          </span>
        )}
        {pr.stateWarning && <span className="banner" role="status">{pr.stateWarning}</span>}
      </div>
      <div className="panel-switcher" role="group" aria-label="Workspace panels">
        <button className="panel-button" data-testid="header/panel/files" data-panel="files" data-active={activePanel === 'files'} aria-pressed={activePanel === 'files'} onClick={() => setActivePanel('files')}>Files <span>{files.length}</span></button>
        <button className="panel-button" data-testid="header/panel/code" data-panel="code" data-active={activePanel === 'code'} aria-pressed={activePanel === 'code'} onClick={() => setActivePanel('code')}>Code</button>
        <button className="panel-button" data-testid="header/panel/comments" data-panel="comments" data-active={activePanel === 'comments'} aria-pressed={activePanel === 'comments'} onClick={() => setActivePanel('comments')}>Comments <span>{(comments?.threads.length ?? 0) + drafts}</span></button>
      </div>
    </header>
  );
}
