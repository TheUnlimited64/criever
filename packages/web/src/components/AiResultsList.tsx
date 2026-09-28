import { useState } from 'react';
import type { AiActiveReview, AiFinding, AiLookout, AiReviewRun, Side } from '@criever/shared';
import { usePr } from '../hooks';
import { useStore } from '../store';

export function AiResultsList({ runs, findings, lookouts, activeReviews = [] }: { runs: readonly AiReviewRun[]; findings: readonly AiFinding[]; lookouts: readonly AiLookout[]; activeReviews?: readonly AiActiveReview[] }) {
  const { openDiff, setAiOpen, setAiJump, setRange } = useStore();
  const head = usePr().data?.sourceHead;
  const [navigationError, setNavigationError] = useState('');
  const jump = (path: string, side: Side, line: number, anchorCommit?: string) => {
    if (anchorCommit && anchorCommit !== head) { setNavigationError('This result belongs to an earlier revision. Open that review to inspect its line.'); return; }
    setNavigationError('');
    setRange(null);
    openDiff(path);
    setAiJump({ path, side, line });
    setAiOpen(false);
  };
  if (!runs.length && !findings.length && !lookouts.length && !activeReviews.length) return <p className="ai-empty">No AI results yet. Run a review to collect private findings here.</p>;
  const groups = runs.length ? [...runs].reverse() : findings.length || lookouts.length ? [{ id: 'legacy', harnessId: '', completedAt: '', head: '', findings: findings.length, lookouts: lookouts.length, first: null }] : [];
  const count = groups.length + activeReviews.length;
  const findingCount = activeReviews.reduce((total, run) => total + run.findings.length, findings.length);
  const lookoutCount = activeReviews.reduce((total, run) => total + run.lookouts.length, lookouts.length);
  return <div className="ai-results" data-testid="ai/results">
    {navigationError && <p className="ai-error" role="alert">{navigationError}</p>}
     <div className="ai-results-total">{count} {count === 1 ? 'review' : 'reviews'} · {findingCount} {findingCount === 1 ? 'finding' : 'findings'} · {lookoutCount} {lookoutCount === 1 ? 'look-out' : 'look-outs'}</div>
     {activeReviews.map(run => <section className="ai-results-run ai-results-active" key={run.id} data-testid={`ai/active-review/${run.id}`}>
       <h3>{run.status === 'failed' ? 'Review failed' : run.status === 'incomplete' ? 'Review incomplete' : 'Review in progress'}<small>{run.harnessId} · {run.message ?? run.status}</small></h3>
       {!run.findings.length && !run.lookouts.length && <p className="ai-results-empty">Waiting for provisional findings or look-outs.</p>}
       {run.findings.map(item => <button className="ai-result-item" data-testid={`ai/result/${item.id}`} key={item.id} onClick={() => jump(item.path, item.side, item.line, item.anchorCommit)} aria-label={`Finding: ${item.body}`}><span className="ai-result-meta">Provisional finding · {item.severity} · {item.path}:{item.line}</span><span className="ai-result-body">{item.body}</span></button>)}
       {run.lookouts.map(item => item.path && item.side && item.line ? <button className="ai-result-item lookout" data-testid={`ai/result/${item.id}`} key={item.id} onClick={() => jump(item.path ?? '', item.side ?? 'new', item.line ?? 0, item.anchorCommit)} aria-label={`Look at this: ${item.body}`}><span className="ai-result-meta">Provisional look-out · {item.path}:{item.line}</span><span className="ai-result-body">{item.body}</span></button> : <div className="ai-result-item lookout" data-testid={`ai/result/${item.id}`} key={item.id}><span className="ai-result-meta">Provisional look-out</span><span className="ai-result-body">{item.body}</span></div>)}
     </section>)}
    {groups.map((run, index) => {
      const matchedFindings = findings.filter(item => (item.reviewId ?? 'legacy') === run.id);
      const matchedLookouts = lookouts.filter(item => (item.reviewId ?? 'legacy') === run.id);
      return <section className="ai-results-run" key={run.id}>
        <h3>Review {groups.length - index}<small>{run.harnessId && `${run.harnessId} · `}{run.completedAt ? new Date(run.completedAt).toLocaleString() : 'Earlier review'}</small></h3>
        {!matchedFindings.length && !matchedLookouts.length && <p className="ai-results-empty">No findings or look-outs in this run.</p>}
        {matchedFindings.map(item => <button className="ai-result-item" data-testid={`ai/result/${item.id}`} key={item.id} onClick={() => jump(item.path, item.side, item.line, item.anchorCommit)} aria-label={`Finding: ${item.body}`}>
          <span className="ai-result-meta">Finding · {item.severity} · {item.path}:{item.line}</span><span className="ai-result-body">{item.body}</span>
        </button>)}
        {matchedLookouts.map(item => item.path && item.side && item.line ? <button className="ai-result-item lookout" data-testid={`ai/result/${item.id}`} key={item.id} onClick={() => { if (item.path && item.side && item.line) jump(item.path, item.side, item.line, item.anchorCommit); }} aria-label={`Look at this: ${item.body}`}>
          <span className="ai-result-meta">Look at this · {item.path}:{item.line}</span><span className="ai-result-body">{item.body}</span>
        </button> : <div className="ai-result-item lookout" data-testid={`ai/result/${item.id}`} key={item.id}><span className="ai-result-meta">Look at this</span><span className="ai-result-body">{item.body}</span></div>)}
      </section>;
    })}
  </div>;
}
