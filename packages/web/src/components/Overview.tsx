import { useState } from 'react';
import { usePr, useRangeHasLocalOnly } from '../hooks';
import { useStore } from '../store';
import { flavorForProviderKind, renderMarkdown } from './markdown';
import { Overlay } from './Overlay';

const short = (h: string) => h.slice(0, 7);
const day = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };

/**
 * What the PR says about itself, and the commits that make it up — the two things you read before
 * the diff. Picking a commit here scopes the whole review to it; shift-picking a second spans them.
 */
export function Overview() {
  const pr = usePr().data;
  const { range, setRange, setOverlay } = useStore();
  const localOnlyInScope = useRangeHasLocalOnly();
  // The commit a shift-click measures its range from. Local, not derived: the range alone can't say
  // which end you clicked first, and that's what decides which way a shift-click extends.
  const [anchor, setAnchor] = useState<number | null>(null);
  const close = () => setOverlay(null);
  if (!pr) return null;
  const local = pr.kind === 'local';
  const commits = pr.commits; // newest first, both providers

  /** The commit before `i` *within the review* — never `hash^`, which for the oldest commit walks
   *  onto the destination branch (and fails outright on a root commit). */
  const parentOf = (i: number) => commits[i + 1]?.hash ?? pr.mergeBase;

  // Which rows the current range covers, read back off the range itself so the chip in the header
  // and the highlight here can never disagree. A range that didn't come from this list (say
  // "since your last visit") simply matches nothing, and the footer states it instead.
  const lo = range ? commits.findIndex(c => c.hash === range.head) : -1;
  const hi = range ? commits.findIndex((_, i) => parentOf(i) === range.base) : -1;
  const inRange = (i: number) => lo >= 0 && hi >= lo && i >= lo && i <= hi;
  const readOnly = !!range && range.head !== pr.sourceHead;

  const pick = (i: number, shift: boolean) => {
    if (shift && anchor != null) {
      const a = Math.min(anchor, i), b = Math.max(anchor, i);
      setRange({ base: parentOf(b), head: commits[a]!.hash });
    } else {
      setAnchor(i);
      setRange({ base: parentOf(i), head: commits[i]!.hash });
    }
  };

  return (
    <Overlay onClose={close} className="overview">
      <div data-testid="overview">
        <div className="ov-hd">
          <div className="ov-titles">
            <div className="ov-title">
              {!local && <span className="prno">#{pr.id}</span>}
              <span data-testid="overview/title">{pr.title}</span>
            </div>
            <div className="ov-sub">{pr.author} · <code>{pr.sourceBranch}</code> → <code>{pr.destinationBranch}</code></div>
          </div>
          {pr.url && <a className="btn sm" data-testid="overview/link" href={pr.url} target="_blank" rel="noreferrer">Open in Bitbucket ↗</a>}
        </div>

        <div className="ov-body">
          <section className="ov-sec">
            <div className="ov-label">Description</div>
            {pr.description
              ? <div className="mdPreview ov-desc" data-testid="overview/description" dangerouslySetInnerHTML={{ __html: renderMarkdown(pr.description, flavorForProviderKind(pr.kind)) }} />
              : <p className="ov-none" data-testid="overview/noDescription">{local ? 'A local review has no pull request, so there’s no description — the commits below are the whole story.' : 'This pull request has no description.'}</p>}
          </section>

          <section className="ov-sec">
            <div className="ov-label">
              Commits <span className="n">{commits.length}</span>
              <button className={`btn sm ov-reset${range ? '' : ' on'}`} data-testid="overview/wholeReview" onClick={() => { setAnchor(null); setRange(null); }}>whole review</button>
            </div>
            <div className="ov-commits" data-testid="overview/commits">
              {commits.map((c, i) => (
                <button key={c.hash} className={`ov-commit${inRange(i) ? ' on' : ''}`} data-testid={`overview/commit/${short(c.hash)}`}
                   title={`${c.message}\n\n${c.hash}`} onClick={e => pick(i, e.shiftKey)}>
                   <span className="ov-dot" />
                  <span className="ov-msg">{c.localOnly === true && <span className="chip amber" data-testid={`overview/commit/${short(c.hash)}/localOnly`}>local-only</span>} {c.message.split('\n')[0]}</span>
                   <span className="ov-hash mono">{short(c.hash)}</span>
                   <span className="ov-date">{day(c.date)}</span>
                </button>
              ))}
              {commits.length === 0 && <p className="ov-none">No commits in this range.</p>}
            </div>
          </section>
        </div>

        <div className="sheet-ft">
          <span className="grow" data-testid="overview/status">
            {range
              ? <>Reviewing <code>{short(range.base)}..{short(range.head)}</code>{readOnly && <> · read-only, comments stay anchored to the review head</>}{localOnlyInScope && <> · local-only work included</>}</>
              : localOnlyInScope
                ? <>Whole review · local-only work included (not pushed) · click a commit to review it alone · shift-click a second for a range</>
                : <>Click a commit to review it alone · shift-click a second for a range</>}
          </span>
          <button className="btn" data-testid="overview/done" onClick={close}>Done</button>
        </div>
      </div>
    </Overlay>
  );
}
