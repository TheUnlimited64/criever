import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AiFinding, AiLookout, AiMessage, AiReviewRun, Anchor, Draft, PrState } from '@criever/shared';

export const emptyState = (): PrState => ({ drafts: [], anchors: {}, viewed: {} });
const newDraft = (draft: Omit<Draft, 'id' | 'createdAt'>): Draft => ({ ...draft, id: crypto.randomUUID(), createdAt: new Date().toISOString() });

export class StateStore {
  state: PrState = emptyState();
  warning: string | null = null;
  constructor(public readonly file: string) {}

  static path(stateDir: string, workspace: string, repo: string, prId: number): string {
    return join(stateDir, workspace, repo, `pr-${prId}.json`);
  }

  async load(): Promise<void> {
    let raw: string;
    try { raw = await readFile(this.file, 'utf8'); } catch { this.state = emptyState(); return; }
    try {
      const j = JSON.parse(raw) as Partial<PrState>;
      this.state = { ...emptyState(), ...j, anchors: j.anchors ?? {}, viewed: j.viewed ?? {}, drafts: j.drafts ?? [] };
    } catch {
      const bak = this.file + '.bak';
      await rename(this.file, bak);
      this.state = emptyState();
      this.warning = `State file was unreadable and moved to ${bak}. Drafts and viewed marks start empty.`;
    }
  }

  private writing: Promise<void> = Promise.resolve();

  private mutate<T>(change: (candidate: PrState) => T): Promise<T> {
    const next = this.writing.catch(() => {}).then(async () => {
      const candidate = structuredClone(this.state);
      const value = change(candidate);
      await this.writeNow(candidate);
      this.state = candidate;
      return value;
    });
    this.writing = next.then(() => {}, () => {});
    return next;
  }

  /** Atomic write: .tmp then rename. Overlapping calls are serialized — the same .tmp path cannot be renamed twice. */
  save(): Promise<void> {
    // One in-process queue; two criever processes on the same PR file would still race, which single-user scope makes moot.
    this.writing = this.writing.catch(() => {}).then(() => this.writeNow());
    return this.writing;
  }

  private async writeNow(state: PrState = this.state): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    let committed = false;
    try {
      await writeFile(tmp, JSON.stringify(state, null, 2));
      await rename(tmp, this.file);
      committed = true;
    } finally {
      if (!committed) await rm(tmp, { force: true }).catch(() => {});
    }
  }

  async addDraft(d: Omit<Draft, 'id' | 'createdAt'>): Promise<Draft> {
    return this.mutate(candidate => {
      const draft = newDraft(d);
      candidate.drafts.push(draft);
      return draft;
    });
  }
  async updateDraft(id: string, body: string): Promise<Draft | null> {
    return this.mutate(candidate => {
      const draft = candidate.drafts.find(item => item.id === id);
      if (!draft) return null;
      draft.body = body;
      return draft;
    });
  }
  async removeDraft(id: string): Promise<boolean> {
    return this.mutate(candidate => {
      const count = candidate.drafts.length;
      candidate.drafts = candidate.drafts.filter(draft => draft.id !== id);
      return candidate.drafts.length !== count;
    });
  }
  async setAnchor(commentId: number, a: Anchor) { await this.mutate(candidate => { candidate.anchors[commentId] = a; }); }
  async setViewed(path: string, head: string | null) {
    await this.mutate(candidate => { if (head) candidate.viewed[path] = head; else delete candidate.viewed[path]; });
  }
  async setLastSeenHead(h: string) { await this.mutate(candidate => { candidate.lastSeenHead = h; }); }
  async loadAiConversation(): Promise<readonly AiMessage[]> { return this.state.aiConversation ?? []; }
  async saveAiConversation(messages: readonly AiMessage[]): Promise<void> { await this.mutate(candidate => { candidate.aiConversation = [...messages]; }); }
  async loadAiThreads(): Promise<Readonly<Record<string, readonly AiMessage[]>>> { return this.state.aiThreads ?? {}; }
  async saveAiThread(id: string, messages: readonly AiMessage[]): Promise<void> { await this.mutate(candidate => { candidate.aiThreads = { ...candidate.aiThreads, [id]: [...messages] }; }); }
  appendAiExchange(id: string, question: AiMessage, answer: AiMessage): Promise<readonly AiMessage[]> {
    return this.mutate(candidate => {
      const messages = [...(candidate.aiThreads?.[id] ?? []), question, answer];
      candidate.aiThreads = { ...candidate.aiThreads, [id]: messages };
      return messages;
    });
  }
  loadAiReviewRuns(): readonly AiReviewRun[] {
    if (this.state.aiReviewRuns) return this.state.aiReviewRuns;
    const legacy = this.state.aiReviewResult;
    return legacy ? [{ ...legacy, id: 'legacy', harnessId: '', completedAt: '' }] : [];
  }
  completeAiReview(run: AiReviewRun, findings: readonly AiFinding[], lookouts: readonly AiLookout[]): Promise<void> {
    return this.mutate(candidate => {
      candidate.aiReviewRuns = [...this.loadAiReviewRuns(), run];
      candidate.aiFindings = [...(candidate.aiFindings ?? []), ...findings];
      candidate.aiLookouts = [...(candidate.aiLookouts ?? []), ...lookouts];
      candidate.aiReviewResult = run;
    });
  }
  mutateAiCollections<T>(change: (findings: AiFinding[], lookouts: AiLookout[]) => T): Promise<T> {
    return this.mutate(candidate => {
      const findings = [...(candidate.aiFindings ?? [])];
      const lookouts = [...(candidate.aiLookouts ?? [])];
      const value = change(findings, lookouts);
      candidate.aiFindings = findings;
      candidate.aiLookouts = lookouts;
      return value;
    });
  }
  async loadAiFindings(): Promise<readonly AiFinding[]> { return this.state.aiFindings ?? []; }
  async saveAiFindings(findings: readonly AiFinding[]): Promise<void> { await this.mutate(candidate => { candidate.aiFindings = [...findings]; }); }
  async loadAiLookouts(): Promise<readonly AiLookout[]> { return this.state.aiLookouts ?? []; }
  async saveAiLookouts(lookouts: readonly AiLookout[]): Promise<void> { await this.mutate(candidate => { candidate.aiLookouts = [...lookouts]; }); }
  async approveAiFinding(id: string, currentHead: string): Promise<Draft | null> {
    return this.mutate(candidate => {
      const finding = candidate.aiFindings?.find(item => item.id === id);
      if (!finding || finding.anchorCommit !== currentHead || candidate.approvedAiFindings?.includes(id)) return null;
      const draft = newDraft({ path: finding.path, line: finding.line, side: finding.side, body: finding.body, anchorCommit: finding.anchorCommit });
      candidate.approvedAiFindings = [...(candidate.approvedAiFindings ?? []), id];
      candidate.drafts.push(draft);
      return draft;
    });
  }
}
