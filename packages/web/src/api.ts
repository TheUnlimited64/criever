import type { AiFinding, AiLookout, AiMessage, AiReviewSummary, ChangedFile, CommentsResponse, DiffResponse, Draft, PrInfo, PublishResult, SearchHit, Side, TreeEntry, VscodeOpenResponse } from '@criever/shared';

export type { AiFinding, AiLookout, AiMessage } from '@criever/shared';
export interface AiState { harnesses: { id: string; name: string; kind: string }[]; conversation: AiMessage[]; threads: Record<string, AiMessage[]>; findings: AiFinding[]; lookouts: AiLookout[]; reviewResult: AiReviewSummary | null; approvedIds: readonly string[] }

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  if (!r.ok) { const e = await r.json().catch(() => ({ error: r.statusText })); throw new Error((e as { error: string }).error); }
  return r.json() as Promise<T>;
}
const qs = (o: Record<string, string | number | null | undefined>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString();

export const api = {
  ai: () => j<AiState>('/api/ai'),
  aiChat: (body: { harnessId: string; message: string; path?: string; line?: number; side?: Side }) => j<{ answer: string; threadId: string; conversation: AiMessage[] }>('/api/ai/chat', { method: 'POST', body: JSON.stringify(body) }),
  aiReview: (harnessId: string) => j<{ findings: AiFinding[]; lookouts: AiLookout[] }>('/api/ai/review', { method: 'POST', body: JSON.stringify({ harnessId }) }),
  aiReword: (id: string, harnessId: string) => j<{ body: string }>(`/api/ai/findings/${encodeURIComponent(id)}/reword`, { method: 'POST', body: JSON.stringify({ harnessId }) }),
  aiUpdateFinding: (id: string, body: string) => j<{ finding: AiFinding }>(`/api/ai/findings/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  aiDeleteFinding: (id: string) => j<{ ok: true }>(`/api/ai/findings/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  aiApproveFinding: (id: string) => j<{ draft: Draft }>(`/api/ai/findings/${encodeURIComponent(id)}/approve`, { method: 'POST' }),
  pr: () => j<PrInfo>('/api/pr'),
  files: (o: { base?: string | null; head?: string | null } = {}) => j<ChangedFile[]>(`/api/files?${qs(o)}`),
  tree: (at?: string | null) => j<TreeEntry[]>(`/api/tree?${qs({ at })}`),
  diff: (path: string, o: { base?: string | null; head?: string | null; context?: number } = {}) => j<DiffResponse>(`/api/diff?${qs({ path, ...o })}`),
  file: (path: string, at?: string | null) => j<{ path: string; at: string; content: string | null }>(`/api/file?${qs({ path, at })}`),
  search: (q: string, at?: string | null) => j<SearchHit[]>(`/api/search?${qs({ q, at })}`),
  comments: () => j<CommentsResponse>('/api/comments'),
  addDraft: (d: { path: string; line: number; side: Side; body: string; parentId?: number }) => j<Draft>('/api/drafts', { method: 'POST', body: JSON.stringify(d) }),
  updateDraft: (id: string, body: string) => j<Draft>(`/api/drafts/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  deleteDraft: (id: string) => j<{ ok: true }>(`/api/drafts/${id}`, { method: 'DELETE' }),
  resolve: (id: number) => j<{ ok: true }>(`/api/comments/${id}/resolve`, { method: 'POST' }),
  setViewed: (path: string, viewed: boolean) => j<{ ok: true }>('/api/viewed', { method: 'POST', body: JSON.stringify({ path, viewed }) }),
  seen: () => j<{ ok: true }>('/api/seen', { method: 'POST' }),
  refresh: () => j<{ ok: true }>('/api/refresh', { method: 'POST' }),
  vscodeOpen: (path: string, line: number) => j<VscodeOpenResponse>('/api/vscode/open', { method: 'POST', body: JSON.stringify({ path, line }) }),
  async publish(onResult: (r: PublishResult) => void): Promise<void> {
    const r = await fetch('/api/publish', { method: 'POST' });
    const reader = r.body!.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) onResult(JSON.parse(line)); }
    }
  },
};
