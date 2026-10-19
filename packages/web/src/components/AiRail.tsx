import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiReviewPhase } from '@criever/shared';
import { api } from '../api';
import { usePr } from '../hooks';
import { useStore } from '../store';
import { threadAnchor } from './AiInline';
import { AiActivity } from './AiActivity';
import { AiMessageView } from './AiMessageView';
import { AiResultsList } from './AiResultsList';

export function AiRail() {
  const query = useQuery({
    queryKey: ['ai'],
    queryFn: api.ai,
    refetchInterval: current => current.state.data?.activeReviews?.some(review => isLive(review.status)) ? 500 : false,
  });
  const queryClient = useQueryClient();
  const pr = usePr().data;
  const { setAiOpen, openDiff, setAiJump, setRange, selectedHarnessId, setSelectedHarnessId, setThreadClosed } = useStore();
  const [question, setQuestion] = useState('');
  const questionVersion = useRef(0);
  const [chatBusy, setChatBusy] = useState(false);
  const [reviewing, setReviewing] = useState(0);
  const [tab, setTab] = useState<'chat' | 'findings'>('chat');
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo(0, 0); }, [tab]);
  const [error, setError] = useState('');
  const state = query.data;
  const runs = state?.reviewRuns ?? [];
  const completedIds = new Set(runs.map(run => run.id));
  const activeReviews = (state?.activeReviews ?? []).filter(review => !completedIds.has(review.id));
  const liveReviews = activeReviews.filter(review => isLive(review.status));
  const resultCount = (state?.findings.length ?? 0) + (state?.lookouts.length ?? 0) + activeReviews.reduce((total, review) => total + review.findings.length + review.lookouts.length, 0);
  const id = state?.harnesses.some(harness => harness.id === selectedHarnessId) ? selectedHarnessId : state?.harnesses[0]?.id ?? '';
  const threads = Object.entries(state?.threads ?? {});
  const general = state?.threads[`general:${pr?.sourceHead}`] ?? state?.conversation ?? [];
  const contextual = threads.filter(([threadId]) => !threadId.startsWith('general:'));
  const refresh = async () => queryClient.invalidateQueries({ queryKey: ['ai'] });

  const chat = async () => {
    if (!id || !question.trim()) return;
    const submittedVersion = questionVersion.current;
    setChatBusy(true); setError('');
    try {
      await api.aiChat({ harnessId: id, message: question.trim() });
      if (questionVersion.current === submittedVersion) setQuestion('');
      await refresh();
    } catch (cause) {
      if (cause instanceof Error) setError(cause.message); else throw cause;
    } finally { setChatBusy(false); }
  };
  const review = async () => {
    if (!id) return;
    setReviewing(count => count + 1); setError(''); setTab('findings');
    try {
      await api.aiReview(id);
      await refresh();
    }
    catch (cause) { if (cause instanceof Error) setError(cause.message); else throw cause; }
    finally { setReviewing(count => count - 1); }
  };
  const jumpToThread = (threadId: string) => {
    const anchor = threadAnchor(threadId);
    const file = threadId.match(/^file:(.*):[a-f\d]+$/)?.[1];
    if (!anchor && !file) return;
    setRange(null);
    setThreadClosed(threadId, false);
    openDiff(anchor?.path ?? decodeURIComponent(file ?? ''));
    if (anchor) setAiJump(anchor);
    setAiOpen(false);
  };

  const navigateTabs = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'chat' : event.key === 'End' ? 'findings' : tab === 'chat' ? 'findings' : 'chat';
    setTab(next);
    document.getElementById(`ai-${next}-tab`)?.focus();
  };

  return <aside className="pane rail ai-rail" data-testid="ai-rail">
    <div className="ai-rail-head"><span><strong>AI review</strong><small>Private · drafts need your approval</small></span><button className="btn sm ghost" aria-label="Close AI chat" onClick={() => setAiOpen(false)}>Close</button></div>
    <div className="ai-rail-tools">
      <label className="sr-only" htmlFor="ai-harness">AI harness</label>
      <select id="ai-harness" value={id} onChange={event => setSelectedHarnessId(event.target.value)} disabled={!state?.harnesses.length}>
        {!state?.harnesses.length && <option value="">No harness configured</option>}
        {state?.harnesses.map(harness => <option value={harness.id} key={harness.id}>{harness.name}</option>)}
      </select>
      <button className="btn sm" disabled={!id} onClick={review}>Run AI review</button>
    </div>
    <div className="ai-rail-tabs" role="tablist" aria-label="AI workbench" onKeyDown={navigateTabs}>
      <button type="button" id="ai-chat-tab" role="tab" tabIndex={tab === 'chat' ? 0 : -1} aria-selected={tab === 'chat'} aria-controls="ai-chat-panel" onClick={() => setTab('chat')}>Chat</button>
      <button type="button" id="ai-findings-tab" role="tab" tabIndex={tab === 'findings' ? 0 : -1} aria-selected={tab === 'findings'} aria-controls="ai-findings-panel" onClick={() => setTab('findings')}>Findings <span className="ai-tab-count">{resultCount}</span></button>
    </div>
    <div className="ai-scroll" ref={scrollRef} data-testid="ai/scroll">
      {state && !state.harnesses.length && <p className="ai-empty ai-configure"><strong>Configure a local AI harness</strong><br />Add a signed-in CLI or any ACP-compatible agent to <code>~/.config/criever/config.json</code>.</p>}
      {(reviewing > 0 || liveReviews.length > 0) && <div role="status" className="ai-review-progress"><AiActivity label="Reviewing changes" /><span>{liveReviews.length || reviewing} {(liveReviews.length || reviewing) === 1 ? 'review' : 'reviews'} running</span></div>}
      <div className="ai-run-notices">
        {activeReviews.map(review => <details className={`ai-run-notice ai-review-${review.status}`} data-testid="ai/review-status" key={review.id}>
          <summary><strong>{phaseLabel(review.status)}</strong><span>{review.harnessId}</span><span className="ai-details-label">Details</span></summary>
          <div role={review.status === 'failed' || review.status === 'incomplete' ? 'alert' : 'status'}>{review.error ?? review.message ?? 'No final result was persisted.'}</div>
        </details>)}
        {runs.length > 0 && <div className="ai-completion" data-testid="ai/review-result" role="status"><strong>Review complete</strong><span>{state?.findings.length || state?.lookouts.length ? `${runs.length} ${runs.length === 1 ? 'review' : 'reviews'} · ${state?.findings.length ?? 0} findings · ${state?.lookouts.length ?? 0} look-outs. Nothing was published.` : 'No findings or look-outs. Nothing was published.'}</span></div>}
      </div>
      {error && <p role="alert" className="ai-error">{error}</p>}
    <div className="ai-content" id="ai-chat-panel" role="tabpanel" aria-labelledby="ai-chat-tab" hidden={tab !== 'chat'}>
      <section className="ai-conversation"><h3>Conversation</h3>
        {!general.length && <p className="ai-empty">Ask a question about this review. Your conversation stays here, not in the published review.</p>}
        <div data-testid="ai/general-messages">{general.map((message, index) => <AiMessageView message={message} key={`${message.role}-${index}`} />)}</div>
        {chatBusy && <AiActivity label="Thinking about your question" />}
      </section>
      <section className="ai-context-list"><h3>Questions on code</h3>
        {!contextual.length && <p className="ai-empty">Ask from a file header or choose private AI after opening a line with +. The thread stays with the code.</p>}
        {contextual.map(([threadId, messages]) => {
          const anchor = threadAnchor(threadId);
          const file = threadId.match(/^file:(.*):[a-f\d]+$/)?.[1];
          const prompt = messages.find(message => message.role === 'user')?.content ?? 'Private question';
          return <button className="ai-thread-summary" data-testid={`ai/thread-summary/${encodeURIComponent(threadId)}`} key={threadId} disabled={!anchor && !file} onClick={() => jumpToThread(threadId)}>
            <span>{anchor ? `${anchor.path}:${anchor.line}` : file ? decodeURIComponent(file) : 'Diff context'}</span><strong>{prompt}</strong>
          </button>;
        })}
      </section>
    </div>
     <div className="ai-content" id="ai-findings-panel" role="tabpanel" aria-labelledby="ai-findings-tab" hidden={tab !== 'findings'}><AiResultsList runs={runs} findings={state?.findings ?? []} lookouts={state?.lookouts ?? []} activeReviews={activeReviews} /></div>
    </div>
    <div className="ai-rail-composer" hidden={tab !== 'chat'}><label className="ai-label">General question<textarea aria-label="General question" placeholder="Ask about the whole review…" value={question} onChange={event => { questionVersion.current++; setQuestion(event.target.value); }} /></label>
      <div className="ai-composer-footer"><small>Private conversation</small><button className="btn primary sm" disabled={chatBusy || !id || !question.trim()} onClick={chat}>Ask AI</button></div></div>
  </aside>;
}

const LIVE_PHASES: readonly AiReviewPhase[] = ['starting', 'observing', 'classifying', 'completing'];
const PHASE_LABELS: Readonly<Record<AiReviewPhase, string>> = {
  starting: 'Review starting', observing: 'Review in progress', classifying: 'Review classifying results', completing: 'Review finishing', complete: 'Review complete', incomplete: 'Review incomplete', failed: 'Review failed',
};
function isLive(status: AiReviewPhase): boolean { return LIVE_PHASES.includes(status); }
function phaseLabel(status: AiReviewPhase): string { return PHASE_LABELS[status]; }
