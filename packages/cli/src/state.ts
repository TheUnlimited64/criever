import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Anchor, Draft, PrState } from '@criever/shared';

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
}
