import { useState } from 'react';
import type { AiFinding, AiLookout, AiMessage, Side } from '@criever/shared';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useStore } from '../store';
import { AiActivity } from './AiActivity';

interface AiAnchor { readonly path: string; readonly line: number; readonly side: Side }
type AiQuestionTarget = AiAnchor | { readonly path: string };

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
    {editing ? <textarea aria-label="Edit finding" value={body} onChange={event => setBody(event.target.value)} /> : <p>{finding.body}</p>}
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
    <span>{lookout.path ? `${lookout.path}:${lookout.line ?? '—'} · AI look-out` : 'Review look-out'}</span><p>{lookout.body}</p>
  </article>;
}

export function AiThreadCard({ threadId, messages }: { threadId: string; messages: readonly AiMessage[] }) {
  return <article className="ai-thread-inline" data-testid={`ai/thread/${encodeURIComponent(threadId)}`}>
    <span>Private Q&amp;A</span>
    {messages.map((message, index) => <p className={`ai-message ${message.role}`} key={`${message.role}-${index}`}><b>{message.role === 'user' ? 'You' : 'AI'}</b> {message.content}</p>)}
  </article>;
}

export function AiQuestionComposer({ target, onCancel, onSent }: { target: AiQuestionTarget; onCancel: () => void; onSent: () => void }) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const query = useQueryClient();
  const selectedHarnessId = useStore(state => state.selectedHarnessId);
  const submit = async () => {
    if (!question.trim()) return;
    setBusy(true); setError('');
    try {
      const state = await api.ai();
      const harnessId = state.harnesses.find(harness => harness.id === selectedHarnessId)?.id ?? state.harnesses[0]?.id;
      if (!harnessId) { setError('Configure an AI harness before asking a question.'); return; }
      await api.aiChat({ harnessId, message: question.trim(), ...target });
      await query.invalidateQueries({ queryKey: ['ai'] });
      onSent();
    } catch (cause) {
      if (cause instanceof Error) setError(cause.message); else throw cause;
    } finally { setBusy(false); }
  };
  const isLine = 'line' in target;
  return <section className="ai-question" aria-label={`Private Q&A about ${target.path}${isLine ? `:${target.line}` : ''}`}>
    <div className="ai-question-heading"><strong>{isLine ? `Ask about line ${target.line}` : 'Ask about this file'}</strong><span>Private · not a review comment</span></div>
    <label className="ai-question-label">{isLine ? 'Private question' : 'Private file question'}<textarea autoFocus aria-label={isLine ? 'Private question' : 'Private file question'} placeholder="What would you like to know?" value={question} onChange={event => setQuestion(event.target.value)} /></label>
    {error && <p role="alert" className="ai-error">{error}</p>}
    {busy && <AiActivity label="Thinking about your question" />}
    <div className="ai-actions"><button className="btn sm primary" aria-label="Send private question" disabled={busy || !question.trim()} onClick={submit}>Ask privately</button><button className="btn sm ghost" onClick={onCancel}>Cancel</button></div>
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
