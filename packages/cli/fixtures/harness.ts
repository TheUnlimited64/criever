import { mkdtempSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildFixtureRepo } from './repo';
import { startStubBitbucket } from './stub-bitbucket';
import { startup } from '../src/startup';
import type { AiRunner } from '../src/ai';
import { createHandler } from '../src/server';
import { StateStore } from '../src/state';
import { LocalReviewStore, emptyReview } from '../src/localreview';

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const port = +(flag('--port') ?? 4799);
const staticDir = flag('--static') ?? (existsSync(join(import.meta.dir, '../../web/dist')) ? join(import.meta.dir, '../../web/dist') : null);

const fixtureAi: AiRunner = {
  list: () => [{ id: 'fixture-harness', name: 'Fixture AI', kind: 'claude' }],
  run: async (_id, prompt) => {
    if (prompt.includes('{"finding":')) return 'Fixture reword';
    if (prompt.includes('\n\nConversation:\n')) return 'Fixture answer';
    return JSON.stringify({
      findings: [
        { path: 'src/api/devices.ts', line: 3, side: 'new', body: 'Potential null access', severity: 'warning' },
        { path: 'src/api/devices.ts', line: 5, side: 'new', body: 'Secondary finding', severity: 'info' },
      ],
      lookouts: [{ path: 'src/api/devices.ts', line: 3, side: 'new', body: 'Check authorization' }],
    });
  },
};

function resetAiState(deps: { store: StateStore }) {
  delete deps.store.state.aiConversation;
  delete deps.store.state.aiThreads;
  delete deps.store.state.aiFindings;
  delete deps.store.state.aiLookouts;
  delete deps.store.state.approvedAiFindings;
}

async function runBitbucket() {
  const tmp = mkdtempSync(join(tmpdir(), 'criever-e2e-'));
  const repo = await buildFixtureRepo(join(tmp, 'repo'));
  const commits = [
    { hash: repo.c3, date: '2026-09-05T08:00:00+00:00', message: 'render visible items' },
    { hash: repo.c2, date: '2026-09-02T08:00:00+00:00', message: 'wire windowed rows' },
    { hash: repo.c1, date: '2026-09-01T08:00:00+00:00', message: 'add row helper' },
  ];
  const stub = startStubBitbucket({ commits, main: repo.main, c2: repo.c2, c3: repo.c3 });
  const stateDir = join(tmp, 'state');
  const stateFile = StateStore.path(stateDir, 'sample-workspace', 'review-fixture', 241);
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify({
    drafts: [], lastSeenHead: repo.c2,
    anchors: {
      301: { path: 'src/devices/DeviceList.tsx', line: 14, side: 'new', anchorCommit: repo.c2, source: 'criever' },
      309: { path: 'src/api/devices.ts', line: 4, side: 'new', anchorCommit: repo.main, source: 'criever' },
    },
    viewed: { 'src/devices/DeviceRow.tsx': repo.c3 },
  }));

  const deps = await startup({
    cwd: repo.root, log: () => {},
    env: { ATLASSIAN_USER_EMAIL: 'alex@example.test', ATLASSIAN_API_TOKEN: 'synthetic-token', CRIEVER_STATE_DIR: stateDir, BITBUCKET_API_BASE: stub.base },
  });
  const vscodeOpened: { path: string; line: number }[] = [];
  // One deps object for the process lifetime: createHandler's routes (POST /api/publish,
  // /api/refresh) reassign d.comments/d.pr/d.mergeBase/d.commits on this same object to reflect
  // a fresh Bitbucket read. Rebuilding a spread copy per request would discard those writes the
  // instant the response finishes, so the next request would look at stale data again.
  const handlerDeps = { ...deps, ai: fixtureAi, staticDir, vscode: { open: async (path: string, line: number) => { vscodeOpened.push({ path, line }); return `http://127.0.0.1:1/?fake&path=${encodeURIComponent(path)}&line=${line}`; } } };
  const handler = createHandler(handlerDeps);
  const server = Bun.serve({
    hostname: '127.0.0.1', port,
    fetch: async (req) => {
      const p = new URL(req.url).pathname;
      if (p === '/__vscode') return Response.json(vscodeOpened);
      if (p === '/__stub/recorded') return Response.json(stub.recorded());
      if (p === '/__reset') {
        stub.reset();
        handlerDeps.store.state.drafts = []; await handlerDeps.store.save();
        resetAiState(handlerDeps);
        await handlerDeps.store.save();
        handlerDeps.comments = await handlerDeps.provider.listComments();
        return Response.json({ ok: true });
      }
      if (p === '/__seed/old-ai-chat') {
        await handlerDeps.store.saveAiThread(`general:${repo.c2}`, [{ role: 'user', content: 'Previous head question' }, { role: 'assistant', content: 'Previous head answer' }]);
        return Response.json({ ok: true });
      }
      return handler(req);
    },
  });
  console.log(JSON.stringify({ url: `http://127.0.0.1:${server.port}`, stubBase: `http://127.0.0.1:${stub.port}`, repoRoot: repo.root }));
}

/** Two seeded agent comments, matching what `criever comment add --author agent` would leave behind. */
const AGENT_COMMENTS = [
  { path: 'src/devices/DeviceList.tsx', line: 13, side: 'new' as const, body: 'This still maps the full `items` array on every filter change; consider memoizing the mapped rows.' },
  { path: 'src/devices/DeviceRow.tsx', line: 3, side: 'new' as const, body: 'style is now applied inline — worth double-checking this against the CSS module class it replaced.' },
];
// A human comment alongside the agent's, so the badge/avatar contrast is visible in the fixture.
const HUMAN_COMMENT = { path: 'src/api/devices.ts', line: 3, side: 'new' as const, body: 'Any reason this dropped the infinite-query paging from the other branch?' };

async function runLocal() {
  const tmp = mkdtempSync(join(tmpdir(), 'criever-e2e-local-'));
  const repo = await buildFixtureRepo(join(tmp, 'repo'));
  const stateDir = join(tmp, 'state');

  const seed = async () => {
    const store = new LocalReviewStore(LocalReviewStore.path(repo.root));
    store.review = emptyReview(repo.main, repo.c3);
    await store.save();
    for (const c of AGENT_COMMENTS) await store.add({ ...c, author: 'agent', agentName: 'coding-agent', anchorCommit: repo.c3 });
    await store.add({ ...HUMAN_COMMENT, author: 'me', anchorCommit: repo.c3 });
  };
  await seed();

  const deps = await startup({ cwd: repo.root, log: () => {}, env: { CRIEVER_STATE_DIR: stateDir }, local: true, base: repo.main, head: repo.c3 });
  const handlerDeps = { ...deps, ai: fixtureAi, staticDir, vscode: { open: async (path: string, line: number) => `http://127.0.0.1:1/?fake&path=${encodeURIComponent(path)}&line=${line}` } };
  const handler = createHandler(handlerDeps);
  const server = Bun.serve({
    hostname: '127.0.0.1', port,
    fetch: async (req) => {
      const p = new URL(req.url).pathname;
      if (p === '/__reset') {
        await seed();
        handlerDeps.store.state.drafts = []; await handlerDeps.store.save();
        resetAiState(handlerDeps);
        await handlerDeps.store.save();
        handlerDeps.comments = await handlerDeps.provider.listComments();
        return Response.json({ ok: true });
      }
      if (p === '/__seed/old-ai-chat') {
        await handlerDeps.store.saveAiThread(`general:${repo.c2}`, [{ role: 'user', content: 'Previous head question' }, { role: 'assistant', content: 'Previous head answer' }]);
        return Response.json({ ok: true });
      }
      return handler(req);
    },
  });
  console.log(JSON.stringify({ url: `http://127.0.0.1:${server.port}`, repoRoot: repo.root }));
}

if (args.includes('--local')) await runLocal(); else await runBitbucket();
