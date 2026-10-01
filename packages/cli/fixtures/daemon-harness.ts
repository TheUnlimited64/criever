import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemon } from '../src/daemon';
import { buildFixtureRepo } from './repo';
import { startStubBitbucket } from './stub-bitbucket';

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = Number(portIndex < 0 ? 4803 : args[portIndex + 1]);
const root = await mkdtemp(join(tmpdir(), 'criever-daemon-e2e-'));
const repo = await buildFixtureRepo(join(root, 'review-fixture'));
const stub = startStubBitbucket({
  main: repo.main, c2: repo.c2, c3: repo.c3,
  commits: [
    { hash: repo.c3, date: '2026-09-05T08:00:00Z', message: 'render visible items' },
    { hash: repo.c2, date: '2026-09-02T08:00:00Z', message: 'wire windowed rows' },
    { hash: repo.c1, date: '2026-09-01T08:00:00Z', message: 'add row helper' },
  ],
});
let revision = repo.c2;
let unavailable = false;
let generation = 0;
let checkoutCount = 0;
const wireFetch: typeof fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (unavailable) return Response.json({ error: { message: 'Provider temporarily unavailable' } }, { status: 503 });
  if (url.pathname.endsWith('/pullrequests') || /\/pullrequests\/24[12]$/.test(url.pathname)) {
    const original = await fetch(`${stub.base}/repositories/sample-workspace/review-fixture/pullrequests/241`, init);
    const raw = await original.json();
    const pr = {
      ...raw, state: 'OPEN', draft: false, updated_on: revision === repo.c2 ? '2026-09-02T08:00:00Z' : '2026-09-05T08:00:00Z',
      source: { ...raw.source, commit: { hash: revision } },
      reviewers: [{ display_name: 'Alex Morgan', uuid: '{me}' }],
      participants: [{ user: { display_name: 'Alex Morgan', uuid: '{me}' }, role: 'REVIEWER', approved: false }],
    };
    const other = { ...pr, id: 242, title: 'Keep catalog filters in the URL', reviewers: [], participants: [], source: { ...pr.source, commit: { hash: repo.c1 } } };
    return Response.json(url.pathname.endsWith('/pullrequests') ? { values: [pr, other] } : url.pathname.endsWith('/242') ? other : pr);
  }
  if (url.pathname.endsWith('/pullrequests/241/commits') && revision === repo.c2) {
    return Response.json({ values: [
      { hash: repo.c2, date: '2026-09-02T08:00:00Z', message: 'wire windowed rows' },
      { hash: repo.c1, date: '2026-09-01T08:00:00Z', message: 'add row helper' },
    ] });
  }
  return fetch(input, init);
}, { preconnect: fetch.preconnect });

const start = () => createDaemon({
  env: {
    HOME: root,
    ATLASSIAN_USER_EMAIL: 'alex@example.test', ATLASSIAN_API_TOKEN: 'synthetic-token',
    BITBUCKET_API_BASE: stub.base, CRIEVER_STATE_DIR: join(root, `state-${generation}`),
    CRIEVER_CACHE_DIR: join(root, `cache-${generation}`),
  },
  staticDir: join(import.meta.dir, '../../web/dist'), fetch: wireFetch,
  pollIntervalMs: 60000, log: message => console.error(message),
});
let daemon = await start();
const server = Bun.serve({
  hostname: '127.0.0.1', port,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/__fixture') return Response.json({ path: repo.root, originalHead: repo.c3, firstHead: repo.c2, updatedHead: repo.c3, checkoutCount });
    if (path === '/__advance' && req.method === 'POST') { revision = repo.c3; return Response.json({ ok: true }); }
    if (path === '/__fail' && req.method === 'POST') { unavailable = true; return Response.json({ ok: true }); }
    if (path === '/__reset' && req.method === 'POST') {
      await daemon.stop();
      generation += 1; revision = repo.c2; unavailable = false; checkoutCount = 0; stub.reset();
      daemon = await start();
      return Response.json({ ok: true });
    }
    if (path.endsWith('/checkout') && req.method === 'POST') checkoutCount += 1;
    return daemon.fetch(req);
  },
});
console.log(`daemon fixture ready: http://127.0.0.1:${server.port}`);
const stop = async () => {
  await server.stop(true); await daemon.stop(); await stub.stop();
  await rm(root, { recursive: true, force: true }); process.exit(0);
};
process.on('SIGTERM', stop); process.on('SIGINT', stop);
