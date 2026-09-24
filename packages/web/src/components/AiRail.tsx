import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { usePr } from '../hooks';
import { useStore } from '../store';
import { threadAnchor } from './AiInline';

export function AiRail() {
  const query = useQuery({ queryKey: ['ai'], queryFn: api.ai });
  const queryClient = useQueryClient();
  const pr = usePr().data;
  const { setAiOpen, openDiff, selectedHarnessId, setSelectedHarnessId } = useStore();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const state = query.data;
  const id = state?.harnesses.some(harness => harness.id === selectedHarnessId) ? selectedHarnessId : state?.harnesses[0]?.id ?? '';
  const threads = Object.entries(state?.threads ?? {});
  const general = state?.threads[`general:${pr?.sourceHead}`] ?? state?.conversation ?? [];
  const contextual = threads.filter(([threadId]) => !threadId.startsWith('general:'));
  const refresh = async () => queryClient.invalidateQueries({ queryKey: ['ai'] });

  const chat = async () => {
    if (!id || !question.trim()) return;
    setBusy(true); setError('');
    try {
      await api.aiChat({ harnessId: id, message: question.trim() });
      setQuestion(''); await refresh();
    } catch (cause) {
      if (cause instanceof Error) setError(cause.message); else throw cause;
    } finally { setBusy(false); }
  };
  const review = async () => {
    if (!id) return;
    setBusy(true); setError('');
    try { await api.aiReview(id); await refresh(); }
    catch (cause) { if (cause instanceof Error) setError(cause.message); else throw cause; }
    finally { setBusy(false); }
  };
  const jumpToThread = (threadId: string) => {
    const anchor = threadAnchor(threadId);
    if (!anchor) return;
    openDiff(anchor.path);
    setAiOpen(false);
    window.setTimeout(() => document.querySelector(`[data-testid="code/row/${anchor.side}/${anchor.line}"]`)?.scrollIntoView({ block: 'center' }), 80);
  };

  return <aside className="pane rail ai-rail" data-testid="ai-rail">
    <div className="pane-hd">AI chat <button className="btn sm ghost" aria-label="Close AI chat" onClick={() => setAiOpen(false)}>Close</button></div>
    <label className="ai-label">Harness<select aria-label="AI harness" className="btn sm" value={id} onChange={event => setSelectedHarnessId(event.target.value)}>{state?.harnesses.map(harness => <option value={harness.id} key={harness.id}>{harness.name}</option>)}</select></label>
    <button className="btn sm" disabled={!id || busy} onClick={review}>Run AI review</button>
    {error && <p role="alert" className="ai-error">{error}</p>}
    <div className="ai-content">
      <section><h3>General chat</h3>{general.map((message, index) => <p className={`ai-message ${message.role}`} key={`${message.role}-${index}`}><b>{message.role === 'user' ? 'You' : 'AI'}</b> {message.content}</p>)}</section>
      <label className="ai-label">General question<textarea aria-label="General question" value={question} onChange={event => setQuestion(event.target.value)} /></label>
      <button className="btn primary sm" disabled={busy || !question.trim()} onClick={chat}>Ask AI</button>
      <section><h3>Contextual Q&amp;A</h3>
        {!contextual.length && <p className="ai-empty">Questions asked from the diff will appear here.</p>}
        {contextual.map(([threadId, messages]) => {
          const anchor = threadAnchor(threadId);
          const prompt = messages.find(message => message.role === 'user')?.content ?? 'Private question';
          return <button className="ai-thread-summary" data-testid={`ai/thread-summary/${encodeURIComponent(threadId)}`} key={threadId} disabled={!anchor} onClick={() => jumpToThread(threadId)}>
            <span>{anchor ? `${anchor.path}:${anchor.line}` : 'Diff context'}</span><strong>{prompt}</strong>
          </button>;
        })}
      </section>
    </div>
    <span className="sr-only" aria-live="polite">{busy ? 'AI is working' : ''}</span>
  </aside>;
}
