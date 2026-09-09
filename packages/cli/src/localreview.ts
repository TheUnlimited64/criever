import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { LocalComment, LocalReview } from '@criever/shared';

const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_BUDGET_MS = 2_000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Advisory cross-process lock: whoever creates the file with O_CREAT|O_EXCL holds it.
 * Retries with a short jittered backoff for up to LOCK_RETRY_BUDGET_MS; if the holder's
 * lock file is (or becomes) older than LOCK_STALE_MS, it's assumed to belong to a crashed
 * process and is removed so the caller can proceed.
 */
async function acquireLock(lockPath: string): Promise<void> {
  const deadline = Date.now() + LOCK_RETRY_BUDGET_MS;
  for (;;) {
    try {
      const fh = await open(lockPath, 'wx');
      await fh.writeFile(`${process.pid} ${new Date().toISOString()}`);
      await fh.close();
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      let age: number | null;
      try { age = Date.now() - (await stat(lockPath)).mtimeMs; } catch { age = null; }
      if (age === null) continue; // lock vanished mid-check; retry immediately
      if (age >= LOCK_STALE_MS || Date.now() >= deadline) {
        await rm(lockPath, { force: true });
        continue;
      }
      await sleep(10 + Math.random() * 30);
    }
  }
}

export const emptyReview = (base = '', head = ''): LocalReview => ({ version: 1, base, head, comments: [], nextId: 1 });

export interface ListFilter { unresolved?: boolean; author?: 'me' | 'agent'; path?: string }

// One write queue per file (not per instance), keyed by path. The agent CLI and the UI
// server each construct their own LocalReviewStore against the same review.json; without
// a shared queue, two instances in this process could each read-modify-write from a stale
// copy and clobber one another the same way two unserialized StateStore saves once did.
const chains = new Map<string, Promise<unknown>>();

export class LocalReviewStore {
  review: LocalReview = emptyReview();
  warning: string | null = null;
  constructor(public readonly file: string) {}

  static path(repoRoot: string): string {
    return join(repoRoot, '.criever', 'review.json');
  }

  async load(): Promise<void> {
    let raw: string;
    try { raw = await readFile(this.file, 'utf8'); } catch { this.review = emptyReview(); return; }
    try {
      const j = JSON.parse(raw) as Partial<LocalReview>;
      this.review = { ...emptyReview(), ...j, comments: j.comments ?? [] };
    } catch {
      const bak = this.file + '.bak';
      await rename(this.file, bak);
      this.review = emptyReview();
      this.warning = `Review file was unreadable and moved to ${bak}. Comments start empty.`;
    }
  }

  /** Atomic write of the current in-memory review: .tmp then rename, serialized per file. */
  save(): Promise<void> {
    return this.enqueue(() => this.writeNow());
  }

  async ensureReview(base: string, head: string): Promise<void> {
    await this.mutate(() => { this.review.base = base; this.review.head = head; });
  }

  async add(c: Omit<LocalComment, 'id' | 'createdAt' | 'resolved' | 'parentId'>): Promise<LocalComment> {
    return this.mutate(() => this.pushComment({ ...c, parentId: null }));
  }

  async reply(parentId: number, c: Omit<LocalComment, 'id' | 'createdAt' | 'resolved' | 'parentId'>): Promise<LocalComment | null> {
    return this.mutate(() => {
      const parent = this.review.comments.find(x => x.id === parentId);
      // replies stay one level deep, matching BbComment's flat root+replies shape
      if (!parent || parent.parentId !== null) return null;
      return this.pushComment({ ...c, parentId });
    });
  }

  /** Marks a comment as published to a real PR, so a later carry-over never offers
   * it again — this is the idempotency the feature depends on, not a nicety. */
  async markPublished(id: number, prId: number, commentId: number): Promise<void> {
    await this.mutate(() => {
      const c = this.review.comments.find(x => x.id === id);
      if (c) c.publishedTo = { prId, commentId };
    });
  }

  /** Resolves a root comment. A reply id is rejected (false) — resolution belongs to the thread, not a reply. */
  async resolve(id: number): Promise<boolean> {
    return this.mutate(() => {
      const c = this.review.comments.find(x => x.id === id);
      if (!c || c.parentId !== null) return false;
      c.resolved = true;
      return true;
    });
  }

  /** Removing a root also removes its replies — an orphaned reply would render nowhere. */
  async remove(id: number): Promise<boolean> {
    return this.mutate(() => {
      const before = this.review.comments.length;
      this.review.comments = this.review.comments.filter(c => c.id !== id && c.parentId !== id);
      return this.review.comments.length !== before;
    });
  }

  list(filter?: ListFilter): LocalComment[] {
    let cs = this.review.comments;
    if (filter?.unresolved) cs = cs.filter(c => !c.resolved);
    if (filter?.author) cs = cs.filter(c => c.author === filter.author);
    if (filter?.path) cs = cs.filter(c => c.path === filter.path);
    return cs;
  }

  private pushComment(c: Omit<LocalComment, 'id' | 'createdAt' | 'resolved'>): LocalComment {
    const comment: LocalComment = { ...c, id: this.review.nextId++, resolved: false, createdAt: new Date().toISOString() };
    this.review.comments.push(comment);
    return comment;
  }

  private async reloadQuiet(): Promise<void> {
    // Missing or transiently corrupt: keep the in-memory review as-is rather than lose it.
    // load() owns the .bak-and-warn corruption path on the initial read.
    try {
      const raw = await readFile(this.file, 'utf8');
      const j = JSON.parse(raw) as Partial<LocalReview>;
      this.review = { ...emptyReview(), ...j, comments: j.comments ?? [] };
    } catch { /* keep current in-memory review */ }
  }

  private async writeNow(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    await writeFile(tmp, JSON.stringify(this.review, null, 2));
    await rename(tmp, this.file);
  }

  /**
   * Runs fn against the freshest on-disk state, then persists the result. Reload and write
   * share one critical section per file, so id allocation and pushes from a concurrent
   * instance are never overwritten by a stale in-memory copy. The in-process queue handles
   * same-process contention lock-free; a `.lock` file (see acquireLock) closes the same
   * window across the CLI-vs-server OS processes this store exists for.
   * This is advisory locking, cooperative only between criever's own processes
   * (both go through mutate()). A third party editing review.json by hand while either is
   * running can still clobber it — no OS mandatory lock, on purpose, no new dependency.
   */
  private mutate<T>(fn: () => T): Promise<T> {
    return this.enqueue(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const lockPath = this.file + '.lock';
      await acquireLock(lockPath);
      try {
        await this.reloadQuiet();
        const result = fn();
        await this.writeNow();
        return result;
      } finally {
        await rm(lockPath, { force: true });
      }
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const prior = chains.get(this.file) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(fn);
    chains.set(this.file, next.catch(() => {}));
    return next;
  }
}
