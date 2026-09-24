import { useState } from 'react';
import type { AiFinding, AiLookout, AiReviewRun, Side } from '@criever/shared';
import { usePr } from '../hooks';
import { useStore } from '../store';

export function AiResultsList({ runs, findings, lookouts }: { runs: readonly AiReviewRun[]; findings: readonly AiFinding[]; lookouts: readonly AiLookout[] }) {
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
  if (!runs.length && !findings.length && !lookouts.length) return <p className="ai-empty">No AI results yet. Run a review to collect private findings here.</p>;
  const groups = runs.length ? [...runs].reverse() : [{ id: 'legacy', harnessId: '', completedAt: '', head: '', findings: findings.length, lookouts: lookouts.length, first: null }];
  return <div className="ai-results" data-testid="ai/results">
    {navigationError && <p className="ai-error" role="alert">{navigationError}</p>}
    <div className="ai-results-total">{groups.length} {groups.length === 1 ? 'review' : 'reviews'} · {findings.length} findings · {lookouts.length} look-outs</div>
    {groups.map((run, index) => {
      const matchedFindings = findings.filter(item => (item.reviewId ?? 'legacy') === run.id);
      const matchedLookouts = lookouts.filter(item => (item.reviewId ?? 'legacy') === run.id);
      return <section className="ai-results-run" key={run.id}>
        <h3>Review {groups.length - index}<small>{run.harnessId && `${run.harnessId} · `}{run.completedAt ? new Date(run.completedAt).toLocaleString() : 'Earlier review'}</small></h3>
        {!matchedFindings.length && !matchedLookouts.length && <p className="ai-results-empty">No findings or look-outs in this run.</p>}
        {matchedFindings.map(item => <button className="ai-result-item" data-testid={`ai/result/${item.id}`} key={item.id} onClick={() => jump(item.path, item.side, item.line, item.anchorCommit)} aria-label={`Finding: ${item.body}`}>
          <span className="ai-result-meta">Finding · {item.severity} · {item.path}:{item.line}</span><span className="ai-result-body">{item.body}</span>
        </button>)}
        {matchedLookouts.map(item => item.path && item.side && item.line ? <button className="ai-result-item lookout" data-testid={`ai/result/${item.id}`} key={item.id} onClick={() => { if (item.path && item.side && item.line) jump(item.path, item.side, item.line, item.anchorCommit); }} aria-label={`Look-out: ${item.body}`}>
          <span className="ai-result-meta">Look-out · {item.path}:{item.line}</span><span className="ai-result-body">{item.body}</span>
        </button> : <div className="ai-result-item lookout" data-testid={`ai/result/${item.id}`} key={item.id}><span className="ai-result-meta">Review look-out</span><span className="ai-result-body">{item.body}</span></div>)}
      </section>;
    })}
  </div>;
}
