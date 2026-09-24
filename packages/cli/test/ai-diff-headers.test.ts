import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReviewMeta } from '@criever/shared';
import { aiEndpoint } from '../src/ai-routes';
import type { AiRunner } from '../src/ai';
import { Git } from '../src/git';
import { StateStore } from '../src/state';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('retains findings when changed lines resemble diff file headers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'criever-ai-headers-'));
  dirs.push(root);
  const git = new Git(root);
  const sh = async (args: string[]) => {
    const proc = Bun.spawn(['git', ...args], {
      cwd: root, stdout: 'pipe', stderr: 'pipe',
      env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com' },
    });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) throw new Error(stderr);
    return stdout.trim();
  };
  await sh(['init', '-q', '-b', 'main']);
  writeFileSync(join(root, 'demo.txt'), '-- a/decoy.txt\n');
  await sh(['add', '.']); await sh(['commit', '-qm', 'base']);
  const base = await sh(['rev-parse', 'HEAD']);
  writeFileSync(join(root, 'demo.txt'), '++ b/decoy.txt\n');
  await sh(['add', '.']); await sh(['commit', '-qm', 'head']);
  const head = await sh(['rev-parse', 'HEAD']);
  const store = new StateStore(join(root, 'state.json')); await store.load();
  const meta: ReviewMeta = { id: 1, title: 'Review', url: null, author: 'test', description: null, sourceBranch: 'main', sourceHead: head, destinationBranch: 'main', destinationHead: base };
  const adapter: AiRunner = {
    list: () => [{ id: 'fake', name: 'Fake', kind: 'codex' }],
    run: async () => JSON.stringify({ findings: [
      { path: 'demo.txt', line: 1, side: 'old', body: 'Check removal', severity: 'warning' },
      { path: 'demo.txt', line: 1, side: 'new', body: 'Check addition', severity: 'warning' },
    ], lookouts: [{ path: 'demo.txt', line: 1, side: 'new', body: 'Check consumers' }] }),
  };

  const response = await aiEndpoint(new Request('http://local/api/ai/review', { method: 'POST', body: JSON.stringify({ harnessId: 'fake' }) }), '/api/ai/review', { adapter, git, store, meta, base });
  const result = await response?.json() as { findings: { path: string; side: string }[]; lookouts: { path: string; side: string }[] };
  expect(result.findings.map(({ path, side }) => ({ path, side }))).toEqual([{ path: 'demo.txt', side: 'old' }, { path: 'demo.txt', side: 'new' }]);
  expect(result.lookouts.map(({ path, side }) => ({ path, side }))).toEqual([{ path: 'demo.txt', side: 'new' }]);
});
