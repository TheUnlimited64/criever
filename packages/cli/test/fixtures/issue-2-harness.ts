import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHandler, type ServerDeps } from '../../src/server';
import { startup } from '../../src/startup';
import { buildFixtureRepo } from '../../fixtures/repo';
import { startStubBitbucket } from '../../fixtures/stub-bitbucket';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const port = Number(flag('--port') ?? 0);
const staticDir = resolve(process.cwd(), flag('--static') ?? 'dist');

async function git(cwd: string, args: string[]): Promise<string> {
  const child = Bun.spawn(['git', ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Issue Two',
      GIT_AUTHOR_EMAIL: 'issue-2@example.test',
      GIT_COMMITTER_NAME: 'Issue Two',
      GIT_COMMITTER_EMAIL: 'issue-2@example.test',
      GIT_AUTHOR_DATE: '2026-09-06T08:00:00Z',
      GIT_COMMITTER_DATE: '2026-09-06T08:00:00Z',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(' ')} failed (${code}): ${stderr.trim()}`);
  return stdout.trim();
}

const main = async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'criever-issue-2-e2e-'));
  const repo = await buildFixtureRepo(join(tmp, 'repo'));
  writeFileSync(join(repo.root, 'src/local-only.ts'), 'export const localOnly = true;\n');
  await git(repo.root, ['add', '.']);
  await git(repo.root, ['commit', '-qm', 'local-only review commit']);
  const localHead = await git(repo.root, ['rev-parse', 'HEAD']);
  const stub = startStubBitbucket({
    commits: [
      { hash: repo.c3, date: '2026-09-05T08:00:00+00:00', message: 'render visible items' },
      { hash: repo.c2, date: '2026-09-02T08:00:00+00:00', message: 'wire windowed rows' },
      { hash: repo.c1, date: '2026-09-01T08:00:00+00:00', message: 'add row helper' },
    ],
    main: repo.main,
    c2: repo.c2,
    c3: repo.c3,
  });
  const deps = await startup({
    cwd: repo.root,
    env: {
      ATLASSIAN_USER_EMAIL: 'reviewer@example.test',
      ATLASSIAN_API_TOKEN: 'issue-2-token',
      BITBUCKET_API_BASE: stub.base,
      CRIEVER_STATE_DIR: join(tmp, 'state'),
    },
    log: () => {},
  });
  const handlerDeps: ServerDeps = { ...deps, staticDir: existsSync(staticDir) ? staticDir : null, vscode: null };
  const handler = createHandler(handlerDeps);
  const server = Bun.serve({
    hostname: '127.0.0.1', port,
    fetch: async request => {
      if (new URL(request.url).pathname === '/__reset') {
        stub.reset();
        handlerDeps.store.state.drafts = [];
        await handlerDeps.store.save();
        handlerDeps.comments = await handlerDeps.provider.listComments();
        return Response.json({ ok: true });
      }
      return handler(request);
    },
  });
  console.log(JSON.stringify({ url: `http://127.0.0.1:${server.port}`, localHead }));
};

await main();
