import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkspaceProject, WorkspacePullRequest, WorkspaceSnapshot } from '@criever/shared';
import { DaemonError } from './errors';

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nullableString = (v: unknown) => v === null || typeof v === 'string';

function validPr(v: unknown): v is WorkspacePullRequest {
  return object(v) && Number.isSafeInteger(v.id) && Number(v.id) > 0
    && ['title', 'url', 'author', 'sourceBranch', 'destinationBranch', 'sourceHead', 'destinationHead', 'updatedAt'].every(k => typeof v[k] === 'string')
    && typeof v.assignedToMe === 'boolean' && typeof v.draft === 'boolean'
    && nullableString(v.reviewedHead) && nullableString(v.reviewedAt)
    && ['unreviewed', 'reviewed', 'updated'].includes(String(v.status));
}
function validProject(v: unknown): v is WorkspaceProject {
  return object(v) && ['id', 'name', 'path', 'owner', 'repo'].every(k => typeof v[k] === 'string' && v[k] !== '')
    && (v.provider === 'github' || v.provider === 'bitbucket') && nullableString(v.refreshedAt)
    && nullableString(v.error) && Array.isArray(v.pullRequests) && v.pullRequests.every(validPr);
}

export class WorkspaceStore {
  projects: WorkspaceProject[] = [];
  private writing: Promise<void> = Promise.resolve();
  private constructor(readonly stateDir: string, readonly pollIntervalMs: number) {}

  static async open(stateDir: string, pollIntervalMs: number): Promise<WorkspaceStore> {
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1) throw new DaemonError('pollIntervalMs must be a positive integer', 400);
    const store = new WorkspaceStore(stateDir, pollIntervalMs);
    await mkdir(stateDir, { recursive: true });
    const lockFile = join(stateDir, 'workspace.lock');
    try {
      const lock = await open(lockFile, 'wx');
      try { await lock.writeFile(String(process.pid)); } finally { await lock.close(); }
    } catch (e) {
      if (!(object(e) && e.code === 'EEXIST')) throw e;
      const pid = (await readFile(lockFile, 'utf8')).trim();
      throw new DaemonError(`Workspace state is locked by daemon process ${pid || '(starting)'}: ${lockFile}. If that process has exited, remove the stale lock before restarting.`, 409);
    }
    const file = join(stateDir, 'workspace.json');
    try {
      const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
      if (!object(parsed) || !Array.isArray(parsed.projects) || !parsed.projects.every(validProject)
        || new Set(parsed.projects.map(p => p.id)).size !== parsed.projects.length
        || new Set(parsed.projects.map(p => p.path)).size !== parsed.projects.length) {
        throw new DaemonError(`Corrupt workspace state: ${file}`, 500);
      }
      store.projects = parsed.projects;
    } catch (e) {
      if (!(object(e) && e.code === 'ENOENT')) {
        await store.release();
        throw new DaemonError(`Cannot load workspace state ${file}: ${e instanceof Error ? e.message : String(e)}`, 500);
      }
    }
    return store;
  }

  snapshot(): WorkspaceSnapshot { return { projects: this.projects, pollIntervalMs: this.pollIntervalMs }; }

  save(): Promise<void> {
    const content = JSON.stringify(this.snapshot(), null, 2);
    this.writing = this.writing.catch(() => {}).then(async () => {
      const file = join(this.stateDir, 'workspace.json');
      await writeFile(file + '.tmp', content);
      await rename(file + '.tmp', file);
    });
    return this.writing;
  }

  async release(): Promise<void> {
    await this.writing;
    await unlink(join(this.stateDir, 'workspace.lock'));
  }
}
