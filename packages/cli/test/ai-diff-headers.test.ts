import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReviewMeta } from '@criever/shared';
import { AiReviewChannel } from '../src/ai-review-channel';
import { aiEndpoint } from '../src/ai-routes';
import type { AiRunner } from '../src/ai';
import { Git } from '../src/git';
import { StateStore } from '../src/state';
import { withReviewEvents } from './ai-review-test-helpers';

const dirs: string[] = [];
const channels: AiReviewChannel[] = [];
afterEach(async () => { for (const channel of channels.splice(0)) await channel.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

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
    run: async () => JSON.stringify({ status: 'complete', limitations: [], observations: [
      { id: 'f1', evidence: 'Removed decoy line', disposition: 'finding' },
      { id: 'f2', evidence: 'Added decoy line', disposition: 'finding' },
      { id: 'l1', evidence: 'Consumer contract', disposition: 'lookout' },
    ], findings: [
      { observationId: 'f1', path: 'demo.txt', line: 1, side: 'old', body: 'Check removal', severity: 'warning' },
      { observationId: 'f2', path: 'demo.txt', line: 1, side: 'new', body: 'Check addition', severity: 'warning' },
    ], lookouts: [{ observationId: 'l1', path: 'demo.txt', line: 1, side: 'new', body: 'Check consumers' }] }),
  };

  const reviewChannel = new AiReviewChannel(store); await reviewChannel.start(); channels.push(reviewChannel);
  const response = await aiEndpoint(new Request('http://local/api/ai/review', { method: 'POST', body: JSON.stringify({ harnessId: 'fake' }) }), '/api/ai/review', { adapter: withReviewEvents(adapter), git, store, meta, base, reviewChannel });
  expect(response?.status).toBe(202);
  const body: unknown = await response?.json();
  if (typeof body !== 'object' || body === null || !('runId' in body) || typeof body.runId !== 'string') throw new Error('review run missing');
  await reviewChannel.waitForCompletion(body.runId);
  const findings = await store.loadAiFindings();
  const lookouts = await store.loadAiLookouts();
  expect(findings.map(({ path, side }) => ({ path, side }))).toEqual([{ path: 'demo.txt', side: 'old' }, { path: 'demo.txt', side: 'new' }]);
  expect(lookouts.map(({ path, side }) => ({ path, side }))).toEqual([{ path: 'demo.txt', side: 'new' }]);
});
