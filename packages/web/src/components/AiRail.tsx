import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { usePr } from '../hooks';
import { useStore } from '../store';
import { threadAnchor } from './AiInline';
import { AiActivity } from './AiActivity';
import { AiMessageView } from './AiMessageView';
import { AiResultsList } from './AiResultsList';

export function AiRail() {
  const query = useQuery({ queryKey: ['ai'], queryFn: api.ai });
  const queryClient = useQueryClient();
  const pr = usePr().data;
  const { setAiOpen, openDiff, setAiJump, setRange, selectedHarnessId, setSelectedHarnessId } = useStore();
  const [question, setQuestion] = useState('');
  const questionVersion = useRef(0);
  const [chatBusy, setChatBusy] = useState(false);
  const [reviewing, setReviewing] = useState(0);
  const [tab, setTab] = useState<'chat' | 'findings'>('chat');
  const [error, setError] = useState('');
  const state = query.data;
  const runs = state?.reviewRuns ?? [];
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
    setReviewing(count => count + 1); setError('');
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
    openDiff(anchor?.path ?? decodeURIComponent(file ?? ''));
    if (anchor) setAiJump(anchor);
    setAiOpen(false);
  };

  return <aside className="pane rail ai-rail" data-testid="ai-rail">
    <div className="pane-hd ai-rail-head"><span><strong>AI workbench</strong><small>Private to this review</small></span><button className="btn sm ghost" aria-label="Close AI chat" onClick={() => setAiOpen(false)}>Close</button></div>
    <div className="ai-rail-tabs" role="tablist" aria-label="AI workbench">
      <button type="button" role="tab" aria-selected={tab === 'chat'} aria-controls="ai-chat-panel" onClick={() => setTab('chat')}>Chat</button>
      <button type="button" role="tab" aria-selected={tab === 'findings'} aria-controls="ai-findings-panel" onClick={() => setTab('findings')}>Findings <span className="ai-tab-count">{(state?.findings.length ?? 0) + (state?.lookouts.length ?? 0)}</span></button>
    </div>
    <div className="ai-rail-setup"><label className="ai-label">Harness<select aria-label="AI harness" className="btn sm" value={id} onChange={event => setSelectedHarnessId(event.target.value)}>{state?.harnesses.map(harness => <option value={harness.id} key={harness.id}>{harness.name}</option>)}</select></label>
      {state && !state.harnesses.length && <p className="ai-empty ai-configure"><strong>Configure a local AI harness</strong><br />Add a signed-in Claude, Codex, or OpenCode CLI to <code>~/.config/criever/config.json</code>.</p>}
      <div className="ai-review-action"><span>Review this diff<small>Findings stay private until you approve them.</small></span><button className="btn sm" disabled={!id} onClick={review}>Run AI review</button></div>
      {reviewing > 0 && <div role="status" className="ai-review-progress"><AiActivity label="Reviewing changes" /><span>{reviewing} {reviewing === 1 ? 'review' : 'reviews'} running</span></div>}
      {runs.length > 0 && <div className="ai-review-result" data-testid="ai/review-result" role="status"><strong>Review complete</strong><span>{state?.findings.length || state?.lookouts.length ? `${runs.length} ${runs.length === 1 ? 'review' : 'reviews'} · ${state?.findings.length ?? 0} findings · ${state?.lookouts.length ?? 0} look-outs. Nothing was published.` : 'No findings or look-outs. Nothing was published.'}</span></div>}
    </div>
    {error && <p role="alert" className="ai-error">{error}</p>}
    <div className="ai-content" id="ai-chat-panel" role="tabpanel" hidden={tab !== 'chat'}>
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
    <div className="ai-content" id="ai-findings-panel" role="tabpanel" hidden={tab !== 'findings'}><AiResultsList runs={runs} findings={state?.findings ?? []} lookouts={state?.lookouts ?? []} /></div>
    <div className="ai-rail-composer" hidden={tab !== 'chat'}><label className="ai-label">General question<textarea aria-label="General question" placeholder="Ask about the whole review…" value={question} onChange={event => { questionVersion.current++; setQuestion(event.target.value); }} /></label>
      <button className="btn primary sm" disabled={chatBusy || !id || !question.trim()} onClick={chat}>Ask AI</button><small>Private conversation · nothing is published</small></div>
  </aside>;
}
