import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { startup } from '../src/startup';

const sh = (cwd: string) => async (args: string[]) => {
  const p = Bun.spawn(['git', ...args], { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, stdout: 'pipe', stderr: 'pipe' });
  await p.exited; return (await new Response(p.stdout).text()).trim();
};

describe('--local default --base never silently reviews an empty range', () => {
  it('on the default branch itself, falls back to HEAD~1 so the review is non-empty', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'criever-basefallback-'));
    const run = sh(dir);
    await run(['init', '-q', '-b', 'main']);
    writeFileSync(join(dir, 'a.ts'), '1\n'); await run(['add', '.']); await run(['commit', '-qm', 'first']);
    writeFileSync(join(dir, 'a.ts'), '1\n2\n'); await run(['commit', '-qam', 'second']);
    const head = await run(['rev-parse', 'HEAD']);
    const parent = await run(['rev-parse', 'HEAD~1']);

    const stateDir = mkdtempSync(join(tmpdir(), 'criever-state-'));
    const deps = await startup({ cwd: dir, env: { CRIEVER_STATE_DIR: stateDir }, local: true, log: () => {} });
    expect(deps.mergeBase).toBe(parent);
    expect(deps.meta.sourceHead).toBe(head);
    const commits = await deps.provider.listCommits();
    expect(commits.map(c => c.hash)).toEqual([head]);

    rmSync(dir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('in a single-commit repo, fails with a UserError naming --base as the fix', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'criever-onecommit-'));
    const run = sh(dir);
    await run(['init', '-q', '-b', 'main']);
    writeFileSync(join(dir, 'a.ts'), '1\n'); await run(['add', '.']); await run(['commit', '-qm', 'only']);

    const stateDir = mkdtempSync(join(tmpdir(), 'criever-state-'));
    await expect(startup({ cwd: dir, env: { CRIEVER_STATE_DIR: stateDir }, local: true, log: () => {} }))
      .rejects.toThrow(/--base/);

    rmSync(dir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });
});
