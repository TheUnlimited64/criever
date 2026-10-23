import { useEffect, useRef, useState } from 'react';
import type { AiFinding, AiLookout, AiMessage, Side } from '@criever/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useStore } from '../store';
import { usePr } from '../hooks';
import { AiActivity } from './AiActivity';
import { AiMessageView, AiResultBody } from './AiMessageView';

interface AiAnchor { readonly path: string; readonly line: number; readonly side: Side }
type AiQuestionTarget = AiAnchor | { readonly path: string } | { readonly lookoutId: string; readonly path?: never };

export function AiFindingCard({ finding, harnessId, onChange }: { finding: AiFinding; harnessId: string; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(finding.body);
  const [rewording, setRewording] = useState(false);
  const [error, setError] = useState('');
  const save = async () => { await api.aiUpdateFinding(finding.id, body); setEditing(false); onChange(); };
  const reword = async () => {
    setRewording(true); setError('');
    try { const result = await api.aiReword(finding.id, harnessId); setBody(result.body); setEditing(true); }
    catch (cause) { if (cause instanceof Error) setError(cause.message); else throw cause; }
    finally { setRewording(false); }
  };
  const approve = async () => { await api.aiApproveFinding(finding.id); onChange(); };
  const remove = async () => { await api.aiDeleteFinding(finding.id); onChange(); };
  return <article className="ai-guidance" data-testid={`ai/finding/${finding.id}`}>
    <span>{finding.path}:{finding.line} · {finding.severity} · AI finding</span>
    {editing ? <textarea aria-label="Edit finding" value={body} onChange={event => setBody(event.target.value)} /> : <AiResultBody body={finding.body} />}
    <div className="ai-actions">
      {editing ? <button className="btn sm" onClick={save}>Save finding</button> : <button className="btn sm ghost" onClick={() => setEditing(true)}>Edit</button>}
      <button className="btn sm ghost" disabled={rewording || !harnessId} onClick={reword}>Reword</button>
      <button className="btn sm ghost" onClick={remove}>Delete</button>
      <button className="btn sm" disabled={editing} onClick={approve}>Approve draft</button>
    </div>
    {rewording && <AiActivity label="Rewording finding" />}
    {error && <p role="alert" className="ai-error">{error}</p>}
  </article>;
}

export function AiLookoutCard({ lookout }: { lookout: AiLookout }) {
  return <article className="ai-guidance lookout" data-testid={`ai/lookout/${lookout.id}`}>
    <span>{lookout.path ? `Look at this · ${lookout.path}:${lookout.line ?? '—'}` : 'Look at this'}</span><AiResultBody body={lookout.body} />
    <AiLookoutDiscussion lookout={lookout} />
  </article>;
}

export function AiLookoutDiscussion({ lookout }: { lookout: AiLookout }) {
  const [open, setOpen] = useState(false);
  const ai = useQuery({ queryKey: ['ai'], queryFn: api.ai });
  const messages = ai.data?.threads[`lookout:${encodeURIComponent(lookout.id)}`] ?? [];
  return <div className="ai-lookout-discussion" data-testid={`ai/lookout-discussion/${lookout.id}`}>
    <button type="button" className="btn sm ghost" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Close discussion' : messages.length ? 'Continue discussion' : 'Discuss look-out'}</button>
    {open && <section className="ai-thread-inline" aria-label="Private look-out discussion">
      <strong>Private discussion</strong>
      {messages.map((message, index) => <AiMessageView message={message} key={`${message.role}-${index}`} />)}
      <AiQuestionComposer target={{ lookoutId: lookout.id }} followUp initialQuestion={messages.length ? '' : 'Can you explain this look-out in simpler terms, with an example?'} onCancel={() => setOpen(false)} onSent={() => {}} />
    </section>}
  </div>;
}

export function AiThreadCard({ threadId, messages }: { threadId: string; messages: readonly AiMessage[] }) {
  const pr = usePr().data;
  const setThreadClosed = useStore(state => state.setThreadClosed);
  const anchor = threadAnchor(threadId);
  const file = threadId.match(/^file:(.*):[a-f\d]+$/)?.[1];
  const target = anchor ?? (file ? { path: decodeURIComponent(file) } : null);
  const revision = threadId.match(/:([a-f\d]+)$/)?.[1];
  const current = !!pr && revision === (anchor?.side === 'old' ? pr.mergeBase : pr.sourceHead);
  return <article className="ai-thread-inline" data-testid={`ai/thread/${encodeURIComponent(threadId)}`}>
    <header className="ai-thread-heading"><strong>Private conversation</strong><span className="ai-thread-heading-actions">{target && <code title={target.path}>{target.path}{anchor ? `:${anchor.line}` : ''}</code>}<button type="button" className="btn sm ghost" aria-label="Close private conversation" onClick={() => setThreadClosed(threadId, true)}>Close</button></span></header>
    {messages.map((message, index) => <AiMessageView message={message} key={`${message.role}-${index}`} />)}
    {target && current && <AiQuestionComposer target={target} followUp onCancel={() => {}} onSent={() => {}} />}
    {target && pr && !current && <p className="ai-thread-history">Earlier revision · follow-ups are available on current-revision threads only.</p>}
  </article>;
}

export function AiQuestionComposer({ target, onCancel, onSent, followUp = false, initialQuestion = '' }: { initialQuestion?: string; target: AiQuestionTarget; onCancel: () => void; onSent: () => void; followUp?: boolean }) {
  const [question, setQuestion] = useState(initialQuestion);
  const questionVersion = useRef(0);
  const mounted = useRef(true);
  const dismissed = useRef(false);
  const closeQuestion = () => { dismissed.current = true; onCancel(); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [progress, setProgress] = useState('Starting AI');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const query = useQueryClient();
  const ai = useQuery({ queryKey: ['ai'], queryFn: api.ai });
  const selectedHarnessId = useStore(state => state.selectedHarnessId);
  const setSelectedHarnessId = useStore(state => state.setSelectedHarnessId);
  const setThreadClosed = useStore(state => state.setThreadClosed);
  const harnesses = ai.data?.harnesses ?? [];
  const harnessId = harnesses.some(harness => harness.id === selectedHarnessId) ? selectedHarnessId : harnesses[0]?.id ?? '';
  const submit = async () => {
    if (!question.trim() || !harnessId) return;
    const submittedVersion = questionVersion.current;
    setBusy(true); setError(''); setProgress('Starting AI');
    try {
      const response = await api.aiChat({ harnessId, message: question.trim(), ...target }, setProgress);
      if (!followUp) setThreadClosed(response.threadId, dismissed.current);
      await query.invalidateQueries({ queryKey: ['ai'] });
      if (mounted.current && questionVersion.current === submittedVersion) { setQuestion(''); onSent(); }
    } catch (cause) {
      if (cause instanceof Error) setError(cause.message); else throw cause;
    } finally { setBusy(false); }
  };
  const isLine = 'line' in target;
  const isLookout = 'lookoutId' in target;
  const questionLabel = isLookout ? 'Look-out question' : followUp ? 'Follow-up question' : isLine ? 'Private question' : 'Private file question';
  return <section className={`ai-question${followUp ? ' follow-up' : ''}`} aria-label={isLookout ? 'Question about this look-out' : `Private Q&A about ${target.path}${isLine ? `:${target.line}` : ''}`}>
    {!followUp && <header className="ai-question-heading"><strong>{isLine ? `Ask about line ${target.line}` : 'Ask about this file'}</strong><button type="button" className="btn sm ghost" aria-label="Close private question" onClick={closeQuestion}>Close</button><code title={target.path}>{target.path}{isLine ? `:${target.line}` : ''}</code></header>}
    <label className="ai-question-label"><span className="sr-only">{questionLabel}</span><textarea autoFocus={!followUp} aria-label={questionLabel} placeholder={isLookout ? 'Ask about this look-out…' : followUp ? 'Ask a follow-up about this code…' : 'Ask a question about this code…'} value={question} onChange={event => { questionVersion.current++; setQuestion(event.target.value); }} /></label>
    <label className="ai-label ai-question-harness">Harness<select aria-label="Private AI harness" className="btn sm" value={harnessId} disabled={busy || !harnesses.length} onChange={event => setSelectedHarnessId(event.target.value)}>{harnesses.map(harness => <option value={harness.id} key={harness.id}>{harness.name}</option>)}</select></label>
    {!harnesses.length && !ai.isLoading && <p className="ai-empty">Configure an AI harness before asking a question.</p>}
    {error && <p role="alert" className="ai-error">{error}</p>}
    {busy && <p role="status" aria-atomic="true">{progress}</p>}
    <div className="ai-question-footer">{!followUp && <small>Private to this review · not a PR comment</small>}<div className="ai-actions"><button className="btn sm ai-submit" aria-label={isLookout ? 'Send look-out question' : followUp ? 'Send follow-up' : 'Send private question'} disabled={busy || !harnessId || !question.trim()} onClick={submit}>{isLookout ? 'Send' : followUp ? 'Send follow-up' : 'Ask privately'}</button>{!followUp && <button className="btn sm ghost" onClick={closeQuestion}>Cancel</button>}</div></div>
  </section>;
}

export function threadAnchor(threadId: string): AiAnchor | null {
  const match = /^(.*):(old|new):(\d+):([a-f\d]+)$/i.exec(threadId);
  if (!match) return null;
  const path = match[1];
  const side = match[2];
  const line = Number(match[3]);
  if (path === undefined || (side !== 'old' && side !== 'new')) return null;
  return { path, side, line };
}
