import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { usePr } from '../hooks';
import { useStore } from '../store';
import { threadAnchor } from './AiInline';
import { AiActivity } from './AiActivity';

export function AiRail() {
  const query = useQuery({ queryKey: ['ai'], queryFn: api.ai });
  const queryClient = useQueryClient();
  const pr = usePr().data;
  const { setAiOpen, openDiff, selectedHarnessId, setSelectedHarnessId } = useStore();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState<'chat' | 'review' | null>(null);
  const [error, setError] = useState('');
  const state = query.data;
  const aiReviewResult = state?.reviewResult;
  const id = state?.harnesses.some(harness => harness.id === selectedHarnessId) ? selectedHarnessId : state?.harnesses[0]?.id ?? '';
  const threads = Object.entries(state?.threads ?? {});
  const general = state?.threads[`general:${pr?.sourceHead}`] ?? state?.conversation ?? [];
  const contextual = threads.filter(([threadId]) => !threadId.startsWith('general:'));
  const refresh = async () => queryClient.invalidateQueries({ queryKey: ['ai'] });

  const chat = async () => {
    if (!id || !question.trim()) return;
    setBusy('chat'); setError('');
    try {
      await api.aiChat({ harnessId: id, message: question.trim() });
      setQuestion(''); await refresh();
    } catch (cause) {
      if (cause instanceof Error) setError(cause.message); else throw cause;
    } finally { setBusy(null); }
  };
  const review = async () => {
    if (!id) return;
    setBusy('review'); setError('');
    try {
      await api.aiReview(id);
      await refresh();
    }
    catch (cause) { if (cause instanceof Error) setError(cause.message); else throw cause; }
    finally { setBusy(null); }
  };
  const jumpToThread = (threadId: string) => {
    const anchor = threadAnchor(threadId);
    const file = threadId.match(/^file:(.*):[a-f\d]+$/)?.[1];
    if (!anchor && !file) return;
    openDiff(anchor?.path ?? decodeURIComponent(file!));
    setAiOpen(false);
    if (anchor) window.setTimeout(() => document.querySelector(`[data-testid="code/row/${anchor.side}/${anchor.line}"]`)?.scrollIntoView({ block: 'center' }), 80);
  };

  return <aside className="pane rail ai-rail" data-testid="ai-rail">
    <div className="pane-hd ai-rail-head"><span><strong>AI workbench</strong><small>Private to this review</small></span><button className="btn sm ghost" aria-label="Close AI chat" onClick={() => setAiOpen(false)}>Close</button></div>
    <div className="ai-rail-setup"><label className="ai-label">Harness<select aria-label="AI harness" className="btn sm" value={id} onChange={event => setSelectedHarnessId(event.target.value)}>{state?.harnesses.map(harness => <option value={harness.id} key={harness.id}>{harness.name}</option>)}</select></label>
      {state && !state.harnesses.length && <p className="ai-empty ai-configure"><strong>Configure a local AI harness</strong><br />Add a signed-in Claude, Codex, or OpenCode CLI to <code>~/.config/criever/config.json</code>.</p>}
      <div className="ai-review-action"><span>Review this diff<small>Findings stay private until you approve them.</small></span><button className="btn sm" disabled={!id || !!busy} onClick={review}>Run AI review</button></div>
      {busy === 'review' && <AiActivity label="Reviewing changes" />}
      {busy !== 'review' && aiReviewResult && aiReviewResult.head === pr?.sourceHead && <div className="ai-review-result" data-testid="ai/review-result" role="status">
        <strong>Review complete</strong>
        <span>{aiReviewResult.findings || aiReviewResult.lookouts ? `${aiReviewResult.findings} findings · ${aiReviewResult.lookouts} look-outs. Results are private beside the changed lines.` : 'No findings or look-outs. Nothing was published.'}</span>
        {aiReviewResult.first && <button className="btn sm ghost" onClick={() => {
          const first = aiReviewResult.first;
          if (!first) return;
          const { path, side, line } = first;
          openDiff(path); setAiOpen(false);
          window.setTimeout(() => document.querySelector(`[data-testid="code/row/${side}/${line}"]`)?.scrollIntoView({ block: 'center' }), 80);
        }}>View first result in diff</button>}
      </div>}
    </div>
    {error && <p role="alert" className="ai-error">{error}</p>}
    <div className="ai-content">
      <section className="ai-conversation"><h3>Conversation</h3>
        {!general.length && <p className="ai-empty">Ask a question about this review. Your conversation stays here, not in the published review.</p>}
        {general.map((message, index) => <div className={`ai-message ${message.role}`} key={`${message.role}-${index}`}><b>{message.role === 'user' ? 'You' : 'AI'}</b><p>{message.content}</p></div>)}
        {busy === 'chat' && <AiActivity label="Thinking about your question" />}
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
    <div className="ai-rail-composer"><label className="ai-label">General question<textarea aria-label="General question" placeholder="Ask about the whole review…" value={question} onChange={event => setQuestion(event.target.value)} /></label>
      <button className="btn primary sm" disabled={!!busy || !id || !question.trim()} onClick={chat}>Ask AI</button><small>Private conversation · nothing is published</small></div>
  </aside>;
}
