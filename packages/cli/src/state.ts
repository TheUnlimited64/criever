import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AiFinding, AiLookout, AiMessage, AiReviewRun, Anchor, Draft, PrState } from '@criever/shared';

export const emptyState = (): PrState => ({ drafts: [], anchors: {}, viewed: {} });

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

  private mutateAi<T>(change: () => T): Promise<T> {
    const next = this.writing.catch(() => {}).then(async () => {
      const value = change();
      await this.writeNow();
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

  private async writeNow(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    await writeFile(tmp, JSON.stringify(this.state, null, 2));
    await rename(tmp, this.file);
  }

  async addDraft(d: Omit<Draft, 'id' | 'createdAt'>): Promise<Draft> {
    const draft: Draft = { ...d, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    this.state.drafts.push(draft); await this.save(); return draft;
  }
  async updateDraft(id: string, body: string): Promise<Draft | null> {
    const d = this.state.drafts.find(x => x.id === id); if (!d) return null;
    d.body = body; await this.save(); return d;
  }
  async removeDraft(id: string): Promise<boolean> {
    const n = this.state.drafts.length;
    this.state.drafts = this.state.drafts.filter(x => x.id !== id);
    if (this.state.drafts.length === n) return false;
    await this.save(); return true;
  }
  async setAnchor(commentId: number, a: Anchor) { this.state.anchors[commentId] = a; await this.save(); }
  async setViewed(path: string, head: string | null) {
    if (head) this.state.viewed[path] = head; else delete this.state.viewed[path];
    await this.save();
  }
  async setLastSeenHead(h: string) { this.state.lastSeenHead = h; await this.save(); }
  async loadAiConversation(): Promise<readonly AiMessage[]> { return this.state.aiConversation ?? []; }
  async saveAiConversation(messages: readonly AiMessage[]): Promise<void> { this.state.aiConversation = [...messages]; await this.save(); }
  async loadAiThreads(): Promise<Readonly<Record<string, readonly AiMessage[]>>> { return this.state.aiThreads ?? {}; }
  async saveAiThread(id: string, messages: readonly AiMessage[]): Promise<void> { this.state.aiThreads = { ...this.state.aiThreads, [id]: [...messages] }; await this.save(); }
  appendAiExchange(id: string, question: AiMessage, answer: AiMessage): Promise<readonly AiMessage[]> {
    return this.mutateAi(() => {
      const messages = [...(this.state.aiThreads?.[id] ?? []), question, answer];
      this.state.aiThreads = { ...this.state.aiThreads, [id]: messages };
      return messages;
    });
  }
  loadAiReviewRuns(): readonly AiReviewRun[] {
    if (this.state.aiReviewRuns) return this.state.aiReviewRuns;
    const legacy = this.state.aiReviewResult;
    return legacy ? [{ ...legacy, id: 'legacy', harnessId: '', completedAt: '' }] : [];
  }
  completeAiReview(run: AiReviewRun, findings: readonly AiFinding[], lookouts: readonly AiLookout[]): Promise<void> {
    return this.mutateAi(() => {
      this.state.aiReviewRuns = [...this.loadAiReviewRuns(), run];
      this.state.aiFindings = [...(this.state.aiFindings ?? []), ...findings];
      this.state.aiLookouts = [...(this.state.aiLookouts ?? []), ...lookouts];
      this.state.aiReviewResult = run;
    });
  }
  mutateAiCollections<T>(change: (findings: AiFinding[], lookouts: AiLookout[]) => T): Promise<T> {
    return this.mutateAi(() => {
      const findings = [...(this.state.aiFindings ?? [])];
      const lookouts = [...(this.state.aiLookouts ?? [])];
      const value = change(findings, lookouts);
      this.state.aiFindings = findings;
      this.state.aiLookouts = lookouts;
      return value;
    });
  }
  async loadAiFindings(): Promise<readonly AiFinding[]> { return this.state.aiFindings ?? []; }
  async saveAiFindings(findings: readonly AiFinding[]): Promise<void> { this.state.aiFindings = [...findings]; await this.save(); }
  async loadAiLookouts(): Promise<readonly AiLookout[]> { return this.state.aiLookouts ?? []; }
  async saveAiLookouts(lookouts: readonly AiLookout[]): Promise<void> { this.state.aiLookouts = [...lookouts]; await this.save(); }
  async approveAiFinding(id: string, currentHead: string): Promise<Draft | null> {
    if (!this.state.aiFindings?.some(finding => finding.id === id)) return null;
    const approved = this.state.approvedAiFindings ?? [];
    if (approved.includes(id)) return null;
    const finding = this.state.aiFindings.find(item => item.id === id);
    if (!finding || finding.anchorCommit !== currentHead) return null;
    this.state.approvedAiFindings = [...approved, id];
    try {
      const draft = await this.addDraft({ path: finding.path, line: finding.line, side: finding.side, body: finding.body, anchorCommit: finding.anchorCommit });
      await this.save();
      return draft;
    } catch (error) {
      this.state.approvedAiFindings = approved;
      throw error;
    }
  }
}
