import { useRef, useState } from 'react';
import type { AiFinding, AiLookout, AiMessage, Side } from '@criever/shared';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useStore } from '../store';
import { usePr } from '../hooks';
import { AiActivity } from './AiActivity';
import { AiMessageView } from './AiMessageView';

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
  const pr = usePr().data;
  const anchor = threadAnchor(threadId);
  const file = threadId.match(/^file:(.*):[a-f\d]+$/)?.[1];
  const target = anchor ?? (file ? { path: decodeURIComponent(file) } : null);
  const revision = threadId.match(/:([a-f\d]+)$/)?.[1];
  const current = !!pr && revision === (anchor?.side === 'old' ? pr.mergeBase : pr.sourceHead);
  return <article className="ai-thread-inline" data-testid={`ai/thread/${encodeURIComponent(threadId)}`}>
    <span>Private Q&amp;A</span>
    {messages.map((message, index) => <AiMessageView message={message} key={`${message.role}-${index}`} />)}
    {target && current && <AiQuestionComposer target={target} followUp onCancel={() => {}} onSent={() => {}} />}
    {target && pr && !current && <p className="ai-thread-history">Earlier revision · follow-ups are available on current-revision threads only.</p>}
  </article>;
}

export function AiQuestionComposer({ target, onCancel, onSent, followUp = false }: { target: AiQuestionTarget; onCancel: () => void; onSent: () => void; followUp?: boolean }) {
  const [question, setQuestion] = useState('');
  const questionVersion = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const query = useQueryClient();
  const selectedHarnessId = useStore(state => state.selectedHarnessId);
  const submit = async () => {
    if (!question.trim()) return;
    const submittedVersion = questionVersion.current;
    setBusy(true); setError('');
    try {
      const state = await api.ai();
      const harnessId = state.harnesses.find(harness => harness.id === selectedHarnessId)?.id ?? state.harnesses[0]?.id;
      if (!harnessId) { setError('Configure an AI harness before asking a question.'); return; }
      await api.aiChat({ harnessId, message: question.trim(), ...target });
      await query.invalidateQueries({ queryKey: ['ai'] });
      if (questionVersion.current === submittedVersion) { setQuestion(''); onSent(); }
    } catch (cause) {
      if (cause instanceof Error) setError(cause.message); else throw cause;
    } finally { setBusy(false); }
  };
  const isLine = 'line' in target;
  return <section className={`ai-question${followUp ? ' follow-up' : ''}`} aria-label={`Private Q&A about ${target.path}${isLine ? `:${target.line}` : ''}`}>
    {!followUp && <div className="ai-question-heading"><strong>{isLine ? `Ask about line ${target.line}` : 'Ask about this file'}</strong><span>Private · not a review comment</span></div>}
    <label className="ai-question-label">{followUp ? 'Follow-up question' : isLine ? 'Private question' : 'Private file question'}<textarea autoFocus={!followUp} aria-label={followUp ? 'Follow-up question' : isLine ? 'Private question' : 'Private file question'} placeholder={followUp ? 'Ask a follow-up about this code…' : 'What would you like to know?'} value={question} onChange={event => { questionVersion.current++; setQuestion(event.target.value); }} /></label>
    {error && <p role="alert" className="ai-error">{error}</p>}
    {busy && <AiActivity label="Thinking about your question" />}
    <div className="ai-actions"><button className="btn sm primary" aria-label={followUp ? 'Send follow-up' : 'Send private question'} disabled={busy || !question.trim()} onClick={submit}>{followUp ? 'Send follow-up' : 'Ask privately'}</button>{!followUp && <button className="btn sm ghost" onClick={onCancel}>Cancel</button>}</div>
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
