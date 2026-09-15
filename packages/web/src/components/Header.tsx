import { useComments, usePr, useInvalidate, useRangeHasLocalOnly, useRangeReadOnly } from '../hooks';
import { api } from '../api';
import { useStore } from '../store';

export function Header() {
  const pr = usePr().data; const drafts = useComments().data?.drafts.length ?? 0;
  const { setOverlay, range, setRange } = useStore(); const invalidate = useInvalidate();
  const readOnly = useRangeReadOnly();
  const localOnlyInScope = useRangeHasLocalOnly();
  if (!pr) return <header className="hdr" data-testid="header" />;
  const local = pr.kind === 'local';
  const newCommits = !local && pr.lastSeenHead && pr.lastSeenHead !== pr.sourceHead ? pr.commits.findIndex(c => c.hash === pr.lastSeenHead) : 0;
  const dismiss = async () => { await api.seen(); invalidate(); };
  return (
    <header className="hdr" data-testid="header">
      {/* everything that describes the review shares one shrinkable group, so the draft count and
          Publish stay put and legible no matter how crowded the context on the left gets */}
      <div className="hdr-left">
        {/* a local review has no repo/PR to link to — kind === 'local' guarantees url is non-null here */}
        {!local && <span className="repo" data-testid="header/repo">{pr.url!.replace(/^https?:\/\/bitbucket\.org\//, '').split('/pull-requests')[0]!.replace('/', ' / ')}</span>}
        {!local && <span className="prno" data-testid="header/prNumber">#{pr.id}</span>}
        <button className="title-btn" data-testid="header/overviewButton" onClick={() => setOverlay('overview')}>
          <span className="title" data-testid="header/title">{pr.title}</span>
        </button>
        {range
          ? <span className="chip blue" data-testid="header/rangeChip">{range.base.slice(0, 7)}..{range.head.slice(0, 7)}{readOnly ? ' · read-only' : ''}{localOnlyInScope ? ' · local-only' : ''}<button data-testid="header/rangeChip/clear" title="Back to the whole review" onClick={() => setRange(null)}>✕</button></span>
          : localOnlyInScope && <span className="chip amber" data-testid="header/localOnly" title="Local-only work is included in this review">local-only</span>}
        {!local && newCommits > 0 && (
          <span className="banner" data-testid="header/newCommitsBanner">▲ {newCommits} new commit{newCommits > 1 ? 's' : ''} since your last visit
            <button data-testid="header/newCommitsBanner/showDiff" onClick={() => setRange({ base: pr.lastSeenHead!, head: pr.sourceHead })}>show diff</button>
            <button data-testid="header/newCommitsBanner/dismiss" onClick={dismiss} title="Mark as seen">✕</button>
          </span>
        )}
        {pr.localBehind > 0 && <span className="chip grey" data-testid="header/localBehind">checkout behind head by {pr.localBehind}</span>}
        {/* last in the group on purpose: it's reference info, so it's what the group's overflow
            eats first — never the banner's buttons or a chip's dismiss control */}
        <span className="flow"><code>{pr.sourceBranch}</code> → <code>{pr.destinationBranch}</code> <span style={{ color: 'var(--ink-3)' }}>· {pr.commits.length} commits</span></span>
      </div>
      <span className="drafts" data-testid="header/draftCount"><span className="dot" /> {drafts} draft{drafts === 1 ? '' : 's'}</span>
      <button className="btn primary" data-testid="header/publishButton" disabled={drafts === 0} onClick={() => setOverlay('publish')}>{local ? 'Save' : 'Publish'}</button>
    </header>
  );
}
