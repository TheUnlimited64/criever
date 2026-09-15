import { describe, expect, it } from 'vitest';
import { createIssue2Fixture, type Issue2Fixture, type Issue2HeadMode } from './fixtures/issue-2-repo';

const call = (fixture: Issue2Fixture, method: string, path: string, body?: unknown) => fixture.handler(new Request(`http://fixture${path}`, {
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
}));
const json = async (request: Promise<Response>): Promise<unknown> => (await request).json();

async function publishResults(fixture: Issue2Fixture): Promise<unknown[]> {
  const text = await (await call(fixture, 'POST', '/api/publish')).text();
  return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

async function withFixture<T>(mode: Issue2HeadMode, test: (fixture: Issue2Fixture) => Promise<T>): Promise<T> {
  const fixture = await createIssue2Fixture(mode);
  try {
    return await test(fixture);
  } finally {
    fixture.close();
  }
}

describe('Bitbucket PRs with local commits', () => {
  it('promotes a local descendant into the whole review and marks local-only commits', async () => {
    await withFixture('descendant', async fixture => {
      // Given: Bitbucket reports the remote source at `remote`, while checked-out `feat` has two descendants.
      // When: the server describes the review and its default diff.
      const pr = await json(call(fixture, 'GET', '/api/pr'));
      const files = await json(call(fixture, 'GET', '/api/files'));
      const diff = await json(call(fixture, 'GET', '/api/diff?path=src/local-only.ts'));

      // Then: the effective head is local, the remote head remains explicit, and local files are reviewable.
      expect(pr).toMatchObject({ sourceHead: fixture.hashes.local2, remoteSourceHead: fixture.hashes.remote });
      expect(pr).toMatchObject({
        commits: [
          { hash: fixture.hashes.local2, localOnly: true },
          { hash: fixture.hashes.local1, localOnly: true },
          { hash: fixture.hashes.remote, localOnly: false },
        ],
      });
      expect(files).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'src/local-only.ts', status: 'A' })]));
      expect(diff).toMatchObject({ head: fixture.hashes.local2, file: expect.objectContaining({ newPath: 'src/local-only.ts' }) });
    });
  });

  const remoteBackedCases = [
    { mode: 'equal', localHead: 'remote', localBehind: 0 },
    { mode: 'behind', localHead: 'base', localBehind: 1 },
    { mode: 'divergent', localHead: 'divergent', localBehind: 1 },
  ] as const satisfies readonly { mode: Issue2HeadMode; localHead: keyof Issue2Fixture['hashes']; localBehind: number }[];

  it.each(remoteBackedCases)('$mode local HEAD keeps the remote-backed review head', async ({ mode, localHead, localBehind }) => {
    await withFixture(mode, async fixture => {
      // Given: the checkout is equal to, behind, or divergent from the distinct remote source head.
      if (mode !== 'equal') expect(fixture.hashes[localHead]).not.toBe(fixture.hashes.remote);

      // When: the server describes the review.
      const pr = await json(call(fixture, 'GET', '/api/pr'));
      const files = await json(call(fixture, 'GET', '/api/files'));

      // Then: remote-backed behavior remains unchanged and no local-only descendant is promoted.
      expect(pr).toMatchObject({ sourceHead: fixture.hashes.remote, remoteSourceHead: fixture.hashes.remote, localBehind });
      expect(pr).toMatchObject({ commits: [{ hash: fixture.hashes.remote }] });
      expect(files).not.toEqual(expect.arrayContaining([expect.objectContaining({ path: 'src/local-only.ts' })]));
    });
  });

  it('retains local-only drafts while publishing a later eligible remote draft', async () => {
    await withFixture('descendant', async fixture => {
      // Given: the first draft is anchored on local-only `local1`, followed by a remote-backed draft.
      const localDraft = await fixture.deps.store.addDraft({
        path: 'src/local-only.ts', line: 1, side: 'new', body: 'local-only pending', anchorCommit: fixture.hashes.local1,
      });
      const remoteDraft = await fixture.deps.store.addDraft({
        path: 'src/remote-only.ts', line: 1, side: 'new', body: 'remote eligible', anchorCommit: fixture.hashes.remote,
      });

      // When: one mixed publish attempt processes the drafts in creation order.
      const results = await publishResults(fixture);

      // Then: the local draft is classified pending, the later remote draft still publishes, and state retains only local work.
      expect(results).toMatchObject([
        { draftId: localDraft.id, ok: false, pending: true },
        { draftId: remoteDraft.id, ok: true, commentId: 9001 },
      ]);
      expect(fixture.publishedBodies().map(raw => JSON.parse(raw))).toMatchObject([{ content: { raw: 'remote eligible' } }]);
      expect(fixture.deps.store.state.drafts.map(draft => draft.id)).toEqual([localDraft.id]);
    });
  });

  it('anchors API drafts by file provenance before publishing a mixed local and remote batch', async () => {
    await withFixture('descendant', async fixture => {
      // Given: the effective review head includes local descendants, but only one selected file is remote-backed.
      const localResponse = await call(fixture, 'POST', '/api/drafts', {
        path: 'src/local-only.ts', line: 1, side: 'new', body: 'local route draft',
      });
      const remoteResponse = await call(fixture, 'POST', '/api/drafts', {
        path: 'src/remote-only.ts', line: 1, side: 'new', body: 'remote route draft',
      });
      expect(await json(Promise.resolve(localResponse))).toMatchObject({ anchorCommit: fixture.hashes.local2 });
      expect(await json(Promise.resolve(remoteResponse))).toMatchObject({ anchorCommit: fixture.hashes.remote });

      const localDraft = fixture.deps.store.state.drafts.find(draft => draft.body === 'local route draft');
      const remoteDraft = fixture.deps.store.state.drafts.find(draft => draft.body === 'remote route draft');
      if (!localDraft || !remoteDraft) throw new Error('expected both API-created drafts in state');

      // When: the mixed batch is published through the public route.
      const results = await publishResults(fixture);

      // Then: local content remains pending, the remote-backed draft publishes, and only the local draft remains.
      expect(results).toMatchObject([
        { draftId: localDraft.id, ok: false, pending: true },
        { draftId: remoteDraft.id, ok: true, commentId: 9001 },
      ]);
      expect(fixture.publishedBodies().map(raw => JSON.parse(raw))).toMatchObject([{ content: { raw: 'remote route draft' } }]);
      expect(fixture.deps.store.state.drafts.map(draft => draft.id)).toEqual([localDraft.id]);
    });
  });

  it('makes the same retained local-only draft eligible after the remote source advances over its anchor', async () => {
    await withFixture('descendant', async fixture => {
      // Given: a draft anchored on local1 cannot yet be represented by the remote source.
      const localDraft = await fixture.deps.store.addDraft({
        path: 'src/local-only.ts', line: 1, side: 'new', body: 'publish after remote advance', anchorCommit: fixture.hashes.local1,
      });
      const first = await publishResults(fixture);
      expect(first).toMatchObject([{ draftId: localDraft.id, ok: false, pending: true }]);
      expect(fixture.deps.store.state.drafts.map(draft => draft.id)).toEqual([localDraft.id]);

      // When: Bitbucket advances its source head to local2, which contains the same anchor.
      fixture.advanceRemoteSource();
      expect((await call(fixture, 'POST', '/api/refresh')).status).toBe(200);
      const refreshed = await json(call(fixture, 'GET', '/api/pr'));

      // Then: the unchanged draft publishes against the advanced remote review and leaves no draft behind.
      expect(refreshed).toMatchObject({ sourceHead: fixture.hashes.local2, remoteSourceHead: fixture.hashes.local2 });
      expect(await publishResults(fixture)).toMatchObject([{ draftId: localDraft.id, ok: true, commentId: 9001 }]);
      expect(fixture.deps.store.state.drafts).toEqual([]);
      expect(fixture.publishedBodies().map(raw => JSON.parse(raw))).toMatchObject([
        { content: { raw: 'publish after remote advance' } },
      ]);
    });
  });
});
