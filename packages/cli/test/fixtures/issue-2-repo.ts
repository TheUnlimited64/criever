import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ServerDeps } from '../../src/server';
import { startup } from '../../src/startup';
import { createHandler } from '../../src/server';

export type Issue2HeadMode = 'descendant' | 'equal' | 'behind' | 'divergent';

export interface Issue2Hashes {
  readonly base: string;
  readonly remote: string;
  readonly local1: string;
  readonly local2: string;
  readonly divergent: string;
}

export interface Issue2Fixture {
  readonly deps: ServerDeps;
  readonly handler: (request: Request) => Promise<Response>;
  readonly hashes: Issue2Hashes;
  readonly publishedBodies: () => readonly string[];
  readonly advanceRemoteSource: () => void;
  readonly close: () => void;
}

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Issue Two',
  GIT_AUTHOR_EMAIL: 'issue-2@example.test',
  GIT_COMMITTER_NAME: 'Issue Two',
  GIT_COMMITTER_EMAIL: 'issue-2@example.test',
};
const GIT_BIN = Bun.which('git') ?? 'git';

async function git(cwd: string, args: string[], date?: string): Promise<string> {
  const child = Bun.spawn([GIT_BIN, ...args], {
    cwd,
    env: { ...process.env, ...GIT_ENV, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
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

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
});

export async function createIssue2Fixture(mode: Issue2HeadMode): Promise<Issue2Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'criever-issue-2-work-'));
  const remoteRoot = mkdtempSync(join(tmpdir(), 'criever-issue-2-remote-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'criever-issue-2-state-'));
  const bare = join(remoteRoot, 'bitbucket.org', 'issue-2', 'review.git');
  mkdirSync(dirname(bare), { recursive: true });

  await git(root, ['init', '-q', '-b', 'main']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/shared.ts'), 'base\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', 'base'], '2026-09-01T08:00:00Z');
  const base = await git(root, ['rev-parse', 'HEAD']);

  await git(root, ['checkout', '-qb', 'feat']);
  writeFileSync(join(root, 'src/shared.ts'), 'remote\n');
  writeFileSync(join(root, 'src/remote-only.ts'), 'remote\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', 'remote source'], '2026-09-02T08:00:00Z');
  const remote = await git(root, ['rev-parse', 'HEAD']);

  mkdirSync(bare, { recursive: true });
  await git(bare, ['init', '-q', '--bare']);
  await git(root, ['remote', 'add', 'origin', bare]);
  await git(root, ['push', '-q', 'origin', 'main', 'feat']);

  await git(root, ['checkout', '-qb', 'divergent', 'main']);
  writeFileSync(join(root, 'src/divergent-only.ts'), 'divergent\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', 'divergent local head'], '2026-09-03T08:00:00Z');
  const divergent = await git(root, ['rev-parse', 'HEAD']);

  await git(root, ['checkout', '-q', 'feat']);
  writeFileSync(join(root, 'src/local-only.ts'), 'local one\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', 'local descendant one'], '2026-09-04T08:00:00Z');
  const local1 = await git(root, ['rev-parse', 'HEAD']);
  writeFileSync(join(root, 'src/local-later.ts'), 'local two\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', 'local descendant two'], '2026-09-05T08:00:00Z');
  const local2 = await git(root, ['rev-parse', 'HEAD']);

  const hashes = { base, remote, local1, local2, divergent } as const;
  const checkedOutHead = mode === 'equal' ? remote : mode === 'behind' ? base : mode === 'divergent' ? divergent : local2;
  if (checkedOutHead !== local2) await git(root, ['reset', '--hard', checkedOutHead]);

  let remoteSourceHead = remote;
  const initialCommits = [{ hash: remote, date: '2026-09-02T08:00:00Z', message: 'remote source' }];
  const advancedCommits = [
    { hash: local2, date: '2026-09-05T08:00:00Z', message: 'local descendant two' },
    { hash: local1, date: '2026-09-04T08:00:00Z', message: 'local descendant one' },
    ...initialCommits,
  ];
  const published: string[] = [];
  const pr = () => ({
    id: 241,
    title: 'Issue 2 local commits',
    created_on: '2026-09-02T09:00:00Z',
    author: { display_name: 'Reviewer', uuid: '{reviewer}' },
    links: { html: { href: 'https://bitbucket.org/issue-2/review/pull-requests/241' } },
    source: { branch: { name: 'feat' }, commit: { hash: remoteSourceHead } },
    destination: { branch: { name: 'main' }, commit: { hash: base } },
  });
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    if (url.includes('/2.0/user')) return response({ uuid: '{me}' });
    if (url.includes('/pullrequests?')) return response({ values: [pr()] });
    if (url.endsWith('/pullrequests/241')) return response(pr());
    if (url.includes('/pullrequests/241/commits')) return response({ values: remoteSourceHead === remote ? initialCommits : advancedCommits });
    if (url.includes('/pullrequests/241/comments') && method === 'GET') return response({ values: [] });
    if (url.includes('/pullrequests/241/comments') && method === 'POST') {
      published.push(typeof init?.body === 'string' ? init.body : '');
      return response({ id: 9000 + published.length }, 201);
    }
    return response({ error: { message: `fixture: no route ${method} ${url}` } }, 404);
  };

  const mockedFetch = Object.assign(fetch, { preconnect: globalThis.fetch.preconnect });
  const deps = await startup({
    cwd: root,
    env: {
      ATLASSIAN_USER_EMAIL: 'reviewer@example.test',
      ATLASSIAN_API_TOKEN: 'issue-2-token',
      BITBUCKET_API_BASE: 'https://api.example/2.0',
      CRIEVER_STATE_DIR: stateDir,
    },
    fetch: mockedFetch,
    log: () => {},
  });
  const handlerDeps: ServerDeps = { ...deps, staticDir: null, vscode: null };
  return {
    deps: handlerDeps,
    handler: createHandler(handlerDeps),
    hashes,
    publishedBodies: () => published,
    advanceRemoteSource: () => { remoteSourceHead = local2; },
    close: () => {
      rmSync(root, { recursive: true, force: true });
      rmSync(remoteRoot, { recursive: true, force: true });
      rmSync(stateDir, { recursive: true, force: true });
    },
  };
}
