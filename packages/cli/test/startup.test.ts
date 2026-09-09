import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { BitbucketError } from '../src/bitbucket';
import { startup } from '../src/startup';

let work: string; let remote: string; let remoteRoot: string; let head = '';
const sh = async (cwd: string, args: string[]) => { const p = Bun.spawn(['git', ...args], { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, stdout: 'pipe', stderr: 'pipe' }); await p.exited; return (await new Response(p.stdout).text()).trim(); };

beforeAll(async () => {
  remoteRoot = mkdtempSync(join(tmpdir(), 'criever-remote-'));
  remote = join(remoteRoot, 'bitbucket.org', 'ws', 'repo.git');
  mkdirSync(remote, { recursive: true });
  await sh(remote, ['init', '-q', '--bare']);
  work = mkdtempSync(join(tmpdir(), 'criever-work-'));
  await sh(work, ['init', '-q', '-b', 'main']); writeFileSync(join(work, 'a.txt'), 'a\n'); await sh(work, ['add', '.']); await sh(work, ['commit', '-qm', 'base']);
  await sh(work, ['checkout', '-qb', 'feat']); writeFileSync(join(work, 'a.txt'), 'b\n'); await sh(work, ['commit', '-qam', 'feat']); head = await sh(work, ['rev-parse', 'HEAD']);
  await sh(work, ['remote', 'add', 'origin', remote]); await sh(work, ['push', '-q', 'origin', 'main', 'feat']);
});
afterAll(() => { rmSync(work, { recursive: true, force: true }); rmSync(remoteRoot, { recursive: true, force: true }); });

const fakeFetch = (pr: unknown) => (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  const j = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
  if (url.includes('/2.0/user')) return j({ uuid: '{me}' });
  if (url.includes('/pullrequests?')) return j({ values: pr ? [pr] : [] });
  if (url.includes('/comments')) return j({ values: [] });
  if (url.includes('/commits')) return j({ values: [{ hash: head, date: '2026-01-01T00:00:00Z', message: 'm' }] });
  return new Response('nf', { status: 404 });
}) as unknown as typeof fetch;

const env = () => ({ ATLASSIAN_USER_EMAIL: 'e', ATLASSIAN_API_TOKEN: 't', CRIEVER_STATE_DIR: mkdtempSync(join(tmpdir(), 'st-')), BITBUCKET_API_BASE: 'https://api.example/2.0' });
const PR = { id: 9, title: 'T', created_on: '', author: { display_name: 'A', uuid: '' }, links: { html: { href: 'u' } }, source: { branch: { name: 'feat' }, commit: { hash: '' } }, destination: { branch: { name: 'main' }, commit: { hash: '' } } };

describe('startup', () => {
  it('open PR found → provider mode, unchanged', async () => {
    const pr = { ...PR, source: { ...PR.source, commit: { hash: head } }, destination: { ...PR.destination, commit: { hash: await sh(work, ['rev-parse', 'main']) } } };
    const log: string[] = [];
    const deps = await startup({ cwd: work, env: env(), fetch: fakeFetch(pr), log: s => log.push(s) });
    expect(deps.provider.kind).toBe('bitbucket');
    expect(deps.ws).toBe('ws'); expect(deps.repo).toBe('repo'); expect(deps.meta.id).toBe(9); expect(deps.remote).toBe('origin');
    expect(deps.mergeBase).toBe(await sh(work, ['rev-parse', 'main']));
    expect(deps.store.file).toMatch(/ws\/repo\/pr-9\.json$/);
    expect(log.join('\n')).toMatch(/PR #9/);
  });

  it('no open PR + valid credentials → local mode, announced on one line', async () => {
    const log: string[] = [];
    const deps = await startup({ cwd: work, env: env(), fetch: fakeFetch(null), log: s => log.push(s) });
    expect(deps.provider.kind).toBe('local');
    expect(log.join('\n')).toMatch(/no open PR for feat in ws\/repo.*starting a local review/);
  });

  it('no Bitbucket credentials at all → local mode, not the credentials UserError', async () => {
    const log: string[] = [];
    const env2 = { CRIEVER_STATE_DIR: mkdtempSync(join(tmpdir(), 'st-')), XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'cfg-')), BITBUCKET_API_BASE: 'https://api.example/2.0' };
    const deps = await startup({ cwd: work, env: env2, fetch: fakeFetch(null), log: s => log.push(s) });
    expect(deps.provider.kind).toBe('local');
    expect(log.join('\n')).toMatch(/no Bitbucket credentials.*starting a local review/);
  });

  it('no git remote at all → local mode, announced', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'criever-noremote-'));
    await sh(dir, ['init', '-q', '-b', 'main']);
    writeFileSync(join(dir, 'x.txt'), '1\n'); await sh(dir, ['add', '.']); await sh(dir, ['commit', '-qm', 'one']);
    writeFileSync(join(dir, 'x.txt'), '2\n'); await sh(dir, ['add', '.']); await sh(dir, ['commit', '-qm', 'two']);
    const log: string[] = [];
    const stateDir = mkdtempSync(join(tmpdir(), 'st-'));
    const deps = await startup({ cwd: dir, env: { CRIEVER_STATE_DIR: stateDir }, log: s => log.push(s) });
    expect(deps.provider.kind).toBe('local');
    expect(log.join('\n')).toMatch(/no git remote.*starting a local review/);
    rmSync(dir, { recursive: true, force: true }); rmSync(stateDir, { recursive: true, force: true });
  });

  it('--local forces local mode even when an open PR exists', async () => {
    const pr = { ...PR, source: { ...PR.source, commit: { hash: head } }, destination: { ...PR.destination, commit: { hash: await sh(work, ['rev-parse', 'main']) } } };
    const deps = await startup({ cwd: work, env: env(), fetch: fakeFetch(pr), local: true, log: () => {} });
    expect(deps.provider.kind).toBe('local');
  });

  it('detached HEAD still fails, even with a valid remote and credentials', async () => {
    await sh(work, ['checkout', '-q', head]);
    try {
      await expect(startup({ cwd: work, env: env(), fetch: fakeFetch(null), log: () => {} })).rejects.toThrow(/detached/);
    } finally {
      await sh(work, ['checkout', '-q', 'feat']);
    }
  });

  it('a Bitbucket error while looking for the PR carries the --local hint, and stays fatal', async () => {
    const badFetch = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      const j = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
      if (url.includes('/2.0/user')) return j({ uuid: '{me}' });
      if (url.includes('/pullrequests?')) return new Response(JSON.stringify({ type: 'error', error: { message: 'You may not have access to this repository.' } }), { status: 404 });
      return new Response('nf', { status: 404 });
    }) as unknown as typeof fetch;

    let threw: unknown;
    try { await startup({ cwd: work, env: env(), fetch: badFetch, log: () => {} }); } catch (e) { threw = e; }
    expect(threw).toBeInstanceOf(BitbucketError);
    expect((threw as Error).message).toMatch(/404/);
    expect((threw as Error).message).toMatch(/You may not have access/);
    expect((threw as Error).message).toMatch(/criever --local/);
  });

  it('a remote that is not a supported provider still fails, rather than silently going local', async () => {
    await sh(work, ['remote', 'set-url', 'origin', 'git@github.com:foo/bar.git']);
    try {
      await expect(startup({ cwd: work, env: env(), fetch: fakeFetch(null), log: () => {} })).rejects.toThrow(/Not a bitbucket.org remote/);
    } finally {
      await sh(work, ['remote', 'set-url', 'origin', remote]);
    }
  });
});
