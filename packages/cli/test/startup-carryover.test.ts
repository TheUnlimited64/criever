import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { startup } from '../src/startup';
import { LocalReviewStore } from '../src/localreview';

// Carry-over: unresolved comments left in .criever/review.json before a PR was
// found become drafts once startup finds one, so the Publish sheet is the human gate before
// anything reaches a real PR — and doing that twice must never offer the same comment again.

let work: string; let remote: string; let remoteRoot: string; let head = '';
const sh = async (cwd: string, args: string[]) => { const p = Bun.spawn(['git', ...args], { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, stdout: 'pipe', stderr: 'pipe' }); await p.exited; return (await new Response(p.stdout).text()).trim(); };

beforeEach(async () => {
  remoteRoot = mkdtempSync(join(tmpdir(), 'criever-carry-remote-'));
  remote = join(remoteRoot, 'bitbucket.org', 'ws', 'repo.git');
  mkdirSync(remote, { recursive: true });
  await sh(remote, ['init', '-q', '--bare']);
  work = mkdtempSync(join(tmpdir(), 'criever-carry-work-'));
  await sh(work, ['init', '-q', '-b', 'main']); writeFileSync(join(work, 'a.txt'), 'a\n'); await sh(work, ['add', '.']); await sh(work, ['commit', '-qm', 'base']);
  await sh(work, ['checkout', '-qb', 'feat']); writeFileSync(join(work, 'a.txt'), 'b\n'); await sh(work, ['commit', '-qam', 'feat']); head = await sh(work, ['rev-parse', 'HEAD']);
  await sh(work, ['remote', 'add', 'origin', remote]); await sh(work, ['push', '-q', 'origin', 'main', 'feat']);
});
afterEach(() => { rmSync(work, { recursive: true, force: true }); rmSync(remoteRoot, { recursive: true, force: true }); });

const fakeFetch = () => (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  const j = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
  if (url.includes('/2.0/user')) return j({ uuid: '{me}' });
  if (url.includes('/pullrequests?')) return j({ values: [PR] });
  if (url.includes('/comments')) return j({ values: [] });
  if (url.includes('/commits')) return j({ values: [{ hash: head, date: '2026-01-01T00:00:00Z', message: 'm' }] });
  return new Response('nf', { status: 404 });
}) as unknown as typeof fetch;

const env = () => ({ ATLASSIAN_USER_EMAIL: 'e', ATLASSIAN_API_TOKEN: 't', CRIEVER_STATE_DIR: mkdtempSync(join(tmpdir(), 'st-')), BITBUCKET_API_BASE: 'https://api.example/2.0' });
let PR: any;

describe('carry-over of local comments into a found PR', () => {
  it('unresolved local comments become drafts; resolved ones do not', async () => {
    PR = { id: 9, title: 'T', created_on: '', author: { display_name: 'A', uuid: '' }, links: { html: { href: 'u' } }, source: { branch: { name: 'feat' }, commit: { hash: head } }, destination: { branch: { name: 'main' }, commit: { hash: await sh(work, ['rev-parse', 'main']) } } };

    const review = new LocalReviewStore(LocalReviewStore.path(work));
    await review.load();
    const unresolved = await review.add({ path: 'a.txt', line: 1, side: 'new', body: 'looks off', author: 'agent', agentName: 'coding-agent', anchorCommit: head });
    const resolved = await review.add({ path: 'a.txt', line: 1, side: 'new', body: 'fixed already', author: 'me', anchorCommit: head });
    await review.resolve(resolved.id);

    const e = env();
    const deps = await startup({ cwd: work, env: e, fetch: fakeFetch(), log: () => {} });
    expect(deps.provider.kind).toBe('bitbucket');
    const carried = deps.store.state.drafts.find(d => d.sourceLocalId === unresolved.id);
    expect(carried).toBeTruthy();
    expect(carried!.body).toBe('looks off');
    expect(carried!.author).toBe('agent');
    expect(carried!.agentName).toBe('coding-agent');
    expect(deps.store.state.drafts.some(d => d.sourceLocalId === resolved.id)).toBe(false);
  });

  it('a second startup after publishing imports nothing (idempotency)', async () => {
    PR = { id: 9, title: 'T', created_on: '', author: { display_name: 'A', uuid: '' }, links: { html: { href: 'u' } }, source: { branch: { name: 'feat' }, commit: { hash: head } }, destination: { branch: { name: 'main' }, commit: { hash: await sh(work, ['rev-parse', 'main']) } } };

    const review = new LocalReviewStore(LocalReviewStore.path(work));
    await review.load();
    const unresolved = await review.add({ path: 'a.txt', line: 1, side: 'new', body: 'N+1 query here', author: 'agent', anchorCommit: head });

    const e = env();
    const deps1 = await startup({ cwd: work, env: e, fetch: fakeFetch(), log: () => {} });
    const carried = deps1.store.state.drafts.find(d => d.sourceLocalId === unresolved.id);
    expect(carried).toBeTruthy();

    // Simulate what a successful /api/publish does: remove the draft, mark the source published.
    await deps1.store.removeDraft(carried!.id);
    await deps1.localReview!.markPublished(unresolved.id, 9, 555);

    const deps2 = await startup({ cwd: work, env: e, fetch: fakeFetch(), log: () => {} });
    expect(deps2.store.state.drafts.some(d => d.sourceLocalId === unresolved.id)).toBe(false);
  });

  it('a reply to a not-yet-published parent stays local instead of guessing a provider id', async () => {
    PR = { id: 9, title: 'T', created_on: '', author: { display_name: 'A', uuid: '' }, links: { html: { href: 'u' } }, source: { branch: { name: 'feat' }, commit: { hash: head } }, destination: { branch: { name: 'main' }, commit: { hash: await sh(work, ['rev-parse', 'main']) } } };

    const review = new LocalReviewStore(LocalReviewStore.path(work));
    await review.load();
    const root = await review.add({ path: 'a.txt', line: 1, side: 'new', body: 'root', author: 'me', anchorCommit: head });
    await review.reply(root.id, { path: 'a.txt', line: 1, side: 'new', body: 'a reply', author: 'agent', anchorCommit: head });

    const deps = await startup({ cwd: work, env: env(), fetch: fakeFetch(), log: () => {} });
    expect(deps.store.state.drafts.some(d => d.sourceLocalId === root.id)).toBe(true);
    expect(deps.store.state.drafts.length).toBe(1); // the reply is not carried
  });
});
