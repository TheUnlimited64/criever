import { describe, it, expect } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { startup } from '../src/startup';

const sh = (cwd: string) => async (args: string[]) => {
  const p = Bun.spawn(['git', ...args], { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, stdout: 'pipe', stderr: 'pipe' });
  await p.exited; return (await new Response(p.stdout).text()).trim();
};

async function initRepo(prefix: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const run = sh(dir);
  await run(['init', '-q', '-b', 'main']);
  writeFileSync(join(dir, 'a.ts'), '1\n'); await run(['add', '.']); await run(['commit', '-qm', 'first']);
  writeFileSync(join(dir, 'a.ts'), '1\n2\n'); await run(['commit', '-qam', 'second']);
  return dir;
}

describe('.git/info/exclude keeps .criever/ out of the user\'s git status', () => {
  it('gains the entry exactly once across two runs', async () => {
    const dir = await initRepo('criever-exclude-');
    const stateDir1 = mkdtempSync(join(tmpdir(), 'criever-state-'));
    await startup({ cwd: dir, env: { CRIEVER_STATE_DIR: stateDir1 }, local: true, log: () => {} });
    const stateDir2 = mkdtempSync(join(tmpdir(), 'criever-state-'));
    await startup({ cwd: dir, env: { CRIEVER_STATE_DIR: stateDir2 }, local: true, log: () => {} });

    const content = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8');
    const hits = content.split('\n').filter(l => l.trim() === '/.criever/');
    expect(hits.length).toBe(1);

    rmSync(dir, { recursive: true, force: true });
    rmSync(stateDir1, { recursive: true, force: true });
    rmSync(stateDir2, { recursive: true, force: true });
  });

  it('appends to an existing exclude file with no trailing newline without corrupting the last rule', async () => {
    const dir = await initRepo('criever-exclude-notrail-');
    writeFileSync(join(dir, '.git', 'info', 'exclude'), '*.bak'); // deliberately no trailing newline

    const stateDir = mkdtempSync(join(tmpdir(), 'criever-state-'));
    await startup({ cwd: dir, env: { CRIEVER_STATE_DIR: stateDir }, local: true, log: () => {} });

    const content = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8');
    const lines = content.split('\n').filter(Boolean);
    expect(lines).toEqual(['*.bak', '/.criever/']);

    rmSync(dir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('a failure to write the exclude file does not fail the review', async () => {
    const dir = await initRepo('criever-exclude-fail-');
    chmodSync(join(dir, '.git', 'info'), 0o555); // read-only: exclude can't be created/written there
    const stateDir = mkdtempSync(join(tmpdir(), 'criever-state-'));
    try {
      const deps = await startup({ cwd: dir, env: { CRIEVER_STATE_DIR: stateDir }, local: true, log: () => {} });
      expect(deps.provider.kind).toBe('local');
    } finally {
      chmodSync(join(dir, '.git', 'info'), 0o755);
      rmSync(dir, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
