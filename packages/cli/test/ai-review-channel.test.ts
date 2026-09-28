import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AiAdapter } from '../src/ai';
import { runAiCli } from '../src/ai-cli';
import { AiReviewChannel } from '../src/ai-review-channel';
import { fixture, harnessScript } from './ai-review-fixture';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('authenticated AI review channel', () => {
  it('shows agent posting commands with --help without requiring a review capability', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await runAiCli(['--help'], {})).toBe(0);
      expect(output).toHaveBeenCalledWith(expect.stringContaining('criever --ai'));
      expect(error).not.toHaveBeenCalled();
    } finally { output.mockRestore(); error.mockRestore(); }
  });

  it('accepts CLI posts through a capability-checked loopback TCP transport', async () => {
    const f = await fixture(roots);
    const channel = new AiReviewChannel(f.store);
    await channel.start();
    try {
      const executable = join(f.root, 'codex-harness.sh');
      writeFileSync(executable, harnessScript(join(process.cwd(), 'src/main.ts'), true));
      chmodSync(executable, 0o755);
      const adapter = new AiAdapter([{ id: 'codex', name: 'Codex', kind: 'codex', executable }], f.git);
      let address = '';
      let capability = '';
      const started = await channel.startReview({
        transport: 'tcp', harnessId: 'codex', git: f.git, base: f.base, head: f.head,
        changedFiles: await f.git.changedFiles(f.base, f.head), anchors: new Set(['a.ts\u0000new\u00002']), renames: new Map(),
        launch: (env, signal) => { address = env.CRIEVER_AI_URL ?? ''; capability = env.CRIEVER_AI_TOKEN ?? ''; return adapter.run('codex', 'Inspect revisions', 'patch', { env, signal }); },
      });
      await started.done;
      expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/review$/);
      expect(capability).toMatch(/^[a-f0-9]{64}$/);
      expect((await f.store.loadAiFindings())[0]?.body).toBe('authenticated finding');
      expect(await f.store.loadAiReviewRuns()).toHaveLength(1);
    } finally { await channel.close(); }
  });

  it('accepts real CLI subprocess posts and persists only explicit completion', async () => {
    const f = await fixture(roots);
    const channel = new AiReviewChannel(f.store);
    await channel.start();
    vi.stubEnv('CRIEVER_AI_URL', 'http://127.0.0.1:9/review');
    try {
      const main = join(process.cwd(), 'src/main.ts');
      const executable = join(f.root, 'harness.sh');
      writeFileSync(executable, harnessScript(main, true));
      chmodSync(executable, 0o755);
      const adapter = new AiAdapter([{ id: 'fake', name: 'Fake', kind: 'claude', executable }], f.git);
      const changedFiles = await f.git.changedFiles(f.base, f.head);
      const started = await channel.startReview({
        harnessId: 'fake',
        git: f.git,
        base: f.base,
        head: f.head,
        changedFiles,
        anchors: new Set(['a.ts\u0000new\u00002']),
        renames: new Map(),
        launch: (env, signal) => adapter.run('fake', 'English review instructions', 'patch', { env, signal }),
      });

      await started.done;
      expect((await f.store.loadAiReviewRuns())).toHaveLength(1);
      expect((await f.store.loadAiFindings()).map(item => item.body)).toEqual(['authenticated finding']);
      expect(channel.activeReviews).toEqual([]);
    } finally {
      await channel.close();
    }
  });

  it('marks a successful harness without complete as incomplete and keeps results private', async () => {
    const f = await fixture(roots);
    const channel = new AiReviewChannel(f.store);
    await channel.start();
    try {
      const main = join(process.cwd(), 'src/main.ts');
      const executable = join(f.root, 'incomplete.sh');
      writeFileSync(executable, harnessScript(main, false));
      chmodSync(executable, 0o755);
      const adapter = new AiAdapter([{ id: 'fake', name: 'Fake', kind: 'claude', executable }], f.git);
      const started = await channel.startReview({
        harnessId: 'fake',
        git: f.git,
        base: f.base,
        head: f.head,
        changedFiles: await f.git.changedFiles(f.base, f.head),
        anchors: new Set(['a.ts\u0000new\u00002']),
        renames: new Map(),
        launch: (env, signal) => adapter.run('fake', 'English review instructions', 'patch', { env, signal }),
      });

      await started.done;
      expect(await f.store.loadAiReviewRuns()).toEqual([]);
      expect(channel.activeReviews[0]).toMatchObject({ status: 'incomplete', findings: [{ body: 'authenticated finding' }] });
    } finally {
      await channel.close();
    }
  });

  it('does not persist a complete event when the harness exits unsuccessfully', async () => {
    const f = await fixture(roots);
    const channel = new AiReviewChannel(f.store);
    await channel.start();
    try {
      const main = join(process.cwd(), 'src/main.ts');
      const executable = join(f.root, 'failed-after-complete.sh');
      writeFileSync(executable, harnessScript(main, true, 7));
      chmodSync(executable, 0o755);
      const adapter = new AiAdapter([{ id: 'fake', name: 'Fake', kind: 'claude', executable }], f.git);
      const started = await channel.startReview({
        harnessId: 'fake',
        git: f.git,
        base: f.base,
        head: f.head,
        changedFiles: await f.git.changedFiles(f.base, f.head),
        anchors: new Set(['a.ts\u0000new\u00002']),
        renames: new Map(),
        launch: (env, signal) => adapter.run('fake', 'English review instructions', 'patch', { env, signal }),
      });

      await started.done;
      expect(await f.store.loadAiReviewRuns()).toEqual([]);
      expect(channel.activeReviews[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('status 7') });
    } finally {
      await channel.close();
    }
  });

  it('rejects oversized event requests before applying them', async () => {
    const f = await fixture(roots);
    const channel = new AiReviewChannel(f.store);
    await channel.start();
    let releaseLaunch = () => {};
    let capturedEnv: Readonly<Record<string, string>> | undefined;
    const launchStarted = new Promise<void>(resolve => {
      void channel.startReview({
        harnessId: 'fake',
        git: f.git,
        base: f.base,
        head: f.head,
        changedFiles: [],
        anchors: new Set(),
        renames: new Map(),
        launch: async env => {
          capturedEnv = env;
          await new Promise<void>(resolveLaunch => { releaseLaunch = resolveLaunch; resolve(); });
        },
      });
    });
    try {
      await launchStarted;
      if (!capturedEnv) throw new Error('review launch environment missing');
      const response = await fetch('http://criever-ai/review', {
        unix: channel.socketPath,
        method: 'POST',
        headers: { authorization: `Bearer ${capturedEnv.CRIEVER_AI_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ reviewId: capturedEnv.CRIEVER_AI_REVIEW_ID, type: 'status', phase: 'observing', padding: 'x'.repeat(300_000) }),
      });
      expect(response.status).toBe(413);
      releaseLaunch();
    } finally {
      await channel.close();
    }
  });

  it('fails a review whose cumulative posted evidence exceeds the bounded channel budget', async () => {
    const f = await fixture(roots);
    const channel = new AiReviewChannel(f.store);
    await channel.start();
    let release = () => {};
    let env: Readonly<Record<string, string>> | undefined;
    try {
      const started = await channel.startReview({
        harnessId: 'fake', git: f.git, base: f.base, head: f.head, changedFiles: [], anchors: new Set(), renames: new Map(),
        launch: async vars => { env = vars; await new Promise<void>(resolve => { release = resolve; }); },
      });
      if (!env) throw new Error('review capability missing');
      let rejected = false;
      for (let i = 0; i < 50 && !rejected; i++) {
        const response = await fetch('http://criever-ai/review', {
          unix: channel.socketPath, method: 'POST',
          headers: { authorization: `Bearer ${env.CRIEVER_AI_TOKEN}`, 'content-type': 'application/json' },
          body: JSON.stringify({ reviewId: env.CRIEVER_AI_REVIEW_ID, type: 'observation', id: `o${i}`, evidence: 'x'.repeat(95_000) }),
        });
        rejected = response.status === 413;
      }
      expect(rejected).toBe(true);
      await started.done;
      expect(channel.activeReviews[0]).toMatchObject({ status: 'failed', error: 'review event quota exceeded' });
      expect(await f.store.loadAiReviewRuns()).toEqual([]);
    } finally { release(); await channel.close(); }
  });

  it('drains a running harness before shutdown completes', async () => {
    const f = await fixture(roots);
    const channel = new AiReviewChannel(f.store);
    await channel.start();
    let launchSettled = false;
    let aborted = false;
    const launchStarted = new Promise<void>(resolve => {
      void channel.startReview({
        harnessId: 'fake',
        git: f.git,
        base: f.base,
        head: f.head,
        changedFiles: [],
        anchors: new Set(),
        renames: new Map(),
        launch: async (_env, signal) => {
          resolve();
          await new Promise<void>(done => {
            const timer = setTimeout(done, 25);
            signal?.addEventListener('abort', () => { aborted = true; clearTimeout(timer); done(); }, { once: true });
          });
          launchSettled = true;
        },
      });
    });
    await launchStarted;
    await channel.close();
    expect(aborted).toBe(true);
    expect(launchSettled).toBe(true);
  });
});
