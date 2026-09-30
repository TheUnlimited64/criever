import { describe, it, expect } from 'vitest';
import { GitHubClient, GitHubError } from '../src/github';
import { GitHubProvider } from '../src/providers/github';
import type { PublishBody } from '../src/provider';
import { buildThreads } from '../src/threads';

type Call = { url: URL; init: RequestInit; body: { query?: string; variables?: Record<string, unknown> } };
const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { headers });
const pr = (number = 7, created_at = '2026-09-01') => ({
  number, created_at, title: 'Fix list', body: '  Details  ', html_url: `https://github.com/o/r/pull/${number}`,
  user: { login: 'alex' }, head: { ref: 'feat/list', sha: 'head' }, base: { ref: 'main', sha: 'base' },
});
const connection = <T>(nodes: T[], next: string | null = null) => ({ nodes, pageInfo: { hasNextPage: next != null, endCursor: next } });
const comment = (databaseId: number, diffSide = 'RIGHT') => ({
  fullDatabaseId: String(databaseId), body: `Comment ${databaseId}`, createdAt: '2026-09-02T12:00:00Z', author: { login: 'alex' },
  path: 'old.ts', originalLine: 12, originalCommit: { oid: 'original' }, diffSide,
  line: null, isOutdated: true,
});
const thread = (id = 'thread-one', comments = connection([comment(101)]), isResolved = false) =>
  ({ id, comments, isResolved, diffSide: comments.nodes[0]?.diffSide ?? 'RIGHT' });
const roots: PublishBody[] = [
  { raw: 'first', path: 'a.ts', line: 3, side: 'new', anchorCommit: 'head' },
  { raw: 'second', path: 'b.ts', line: 4, side: 'old', anchorCommit: 'head' },
];
const published = [
  { id: 201, body: 'first', path: 'a.ts', line: 3, side: 'RIGHT' },
  { id: 202, body: 'second', path: 'b.ts', line: 4, side: 'LEFT' },
];
function setup(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchFn = Object.assign(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const call: Call = { url, init, body: init.body ? JSON.parse(String(init.body)) : {} };
    calls.push(call);
    return handler(call);
  }, { preconnect: fetch.preconnect });
  const client = new GitHubClient({ token: 'secret', fetch: fetchFn });
  return { client, provider: new GitHubProvider(client, 'o', 'r', 7), calls };
}
function reviewRoutes(call: Call): Response {
  if (call.url.pathname === '/user') return json({ login: 'Alex' });
  if (call.url.pathname.includes('/issues/')) return json([]);
  if (call.url.pathname === '/graphql') {
    if (call.body.query?.startsWith('mutation')) return json({ data: { resolveReviewThread: { thread: { id: 'thread-one', isResolved: true } } } });
    return json({ data: { repository: { pullRequest: { reviewThreads: connection([thread()]) } } } });
  }
  if (call.url.pathname.endsWith('/replies')) return json({ id: 103 });
  if (call.url.pathname.endsWith('/reviews/9/comments')) return json(published);
  if (call.url.pathname.endsWith('/reviews')) return json({ id: 9 });
  if (call.url.pathname.endsWith('/events')) return json({ id: 9, state: 'COMMENT' });
  if (call.init.method === 'DELETE' && call.url.pathname.endsWith('/reviews/9')) return new Response(null, { status: 204 });
  if (call.url.pathname.endsWith('/pulls/7')) return json(pr());
  throw new Error(`Unexpected request: ${call.url}`);
}

describe('GitHubClient and GitHubProvider', () => {
  it('detects the newest open PR across REST pages using owner:branch and bearer auth', async () => {
    // Given
    const { client, calls } = setup(({ url }) => url.searchParams.get('page') === '2'
      ? json([pr(8, '2026-09-03')])
      : json([pr()], { Link: '<https://api.github.com/repos/o/r/pulls?page=2>; rel="next"' }));
    // When
    const result = await client.findOpenPr('o', 'r', 'feat/list');
    // Then
    expect(result).toMatchObject({ id: 8, sourceBranch: 'feat/list', sourceHead: 'head' });
    expect(calls[0]?.url.searchParams.get('head')).toBe('o:feat/list');
    expect(calls[0]?.url.searchParams.get('state')).toBe('open');
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: 'Bearer secret', Accept: 'application/vnd.github+json' });
  });
  it('returns null when the branch has no PR', async () => {
    const { client } = setup(() => json([]));
    expect(await client.findOpenPr('o', 'r', 'absent')).toBeNull();
  });
  it('normalizes metadata through the provider', async () => {
    const { provider } = setup(() => json(pr()));
    expect(await provider.meta()).toEqual({
      id: 7, title: 'Fix list', description: 'Details', author: 'alex', url: 'https://github.com/o/r/pull/7',
      sourceBranch: 'feat/list', sourceHead: 'head', destinationBranch: 'main', destinationHead: 'base',
    });
  });
  it('normalizes empty descriptions and a deleted author', async () => {
    const { client } = setup(() => json({ ...pr(), body: ' ', user: null }));
    expect(await client.getPr('o', 'r', 7)).toMatchObject({ description: null, author: 'ghost' });
  });
  it('lists commits newest first across pages even when commit dates are skewed', async () => {
    const { provider } = setup(({ url }) => json(
      [{ sha: url.searchParams.has('page') ? 'new' : 'old', commit: { message: 'message', committer: { date: url.searchParams.has('page') ? '2025-01-01' : '2026-01-01' } } }],
      url.searchParams.has('page') ? {} : { Link: '<https://api.github.com/repos/o/r/pulls/7/commits?page=2>; rel="next"' },
    ));
    expect((await provider.listCommits()).map(c => c.hash)).toEqual(['new', 'old']);
  });
  it('paginates threads nested replies and conversation while preserving original outdated anchors', async () => {
    // Given
    const { provider, calls } = setup(call => {
      if (call.url.pathname === '/user') return json({ login: 'Alex' });
      if (call.url.pathname.includes('/issues/')) return call.url.searchParams.has('page')
        ? json([{ id: 302, body: 'second', created_at: '2026-09-03', user: null }])
        : json([{ id: 301, body: 'conversation', created_at: '2026-09-02', user: { login: 'alex' } }],
          { Link: '<https://api.github.com/repos/o/r/issues/7/comments?page=2>; rel="next"' });
      if (call.body.variables?.id === 'thread-one') return json({ data: { node: { comments: connection([comment(102), comment(103)]) } } });
      const page = call.body.variables?.cursor
        ? connection([thread('thread-two', connection([comment(201)]), true)])
        : connection([thread('thread-one', connection([comment(101, 'LEFT')], 'comment-next'))], 'thread-next');
      return json({ data: { repository: { pullRequest: { reviewThreads: page } } } });
    });
    // When
    const comments = await provider.listComments();
    // Then
    expect(comments.map(c => [c.id, c.parentId])).toEqual([[101, null], [102, 101], [103, 101], [201, null], [301, null], [302, null]]);
    expect(comments[0]).toMatchObject({ inline: { path: 'old.ts', from: 12, to: null },
      anchor: { path: 'old.ts', line: 12, side: 'old', anchorCommit: 'original', source: 'provider' }, author: { isMe: true } });
    expect(comments[3]).toMatchObject({ resolved: true, anchor: { side: 'new', anchorCommit: 'original' } });
    expect(comments[4]).toMatchObject({ inline: null, canResolve: false, canReply: false, author: { isMe: true } });
    expect(comments[5]).toMatchObject({ author: { name: 'ghost', isMe: false } });
    expect(calls.find(c => c.body.variables?.id === 'thread-one')?.body.variables?.commentCursor).toBe('comment-next');
    expect(calls.find(c => c.body.variables?.cursor)?.body.variables?.cursor).toBe('thread-next');
  });
  it('supplies exact original anchors to shared thread building', async () => {
    const { provider } = setup(reviewRoutes);
    const comments = await provider.listComments();
    const result = await buildThreads(comments, {}, [{ hash: 'wrong-time-inferred-head', date: '2026-09-01', message: '' }], async () => ({ hunks: [], newPath: null }));
    expect(result.threads[0]?.anchor?.anchorCommit).toBe('original');
  });
  it('preserves file-level thread context without inventing an inline line', async () => {
    const { provider } = setup(call => call.url.pathname === '/graphql'
      ? json({ data: { repository: { pullRequest: { reviewThreads: connection([
        { id: 'file-thread', diffSide: 'RIGHT', isResolved: false, comments: connection([
          { ...comment(101), originalLine: null }, { ...comment(102), originalLine: null },
        ]) },
      ]) } } } })
      : reviewRoutes(call));
    const comments = await provider.listComments();
    const { threads } = await buildThreads(comments, {}, [], async () => { throw new Error('file-level comments have no inline anchor'); });
    expect(threads[0]).toMatchObject({ displayPath: 'old.ts', displayLine: null, anchor: null, replies: [{ id: 102 }] });
  });
  it.each([null, '9007199254740993', 'invalid', '0'])('rejects an unsafe numeric review comment ID: %s', async fullDatabaseId => {
    const { provider } = setup(call => call.url.pathname === '/graphql'
      ? json({ data: { repository: { pullRequest: { reviewThreads: connection([{ ...thread(),
        comments: connection([{ ...comment(101), fullDatabaseId }]) }]) } } } }) : reviewRoutes(call));
    await expect(provider.listComments()).rejects.toMatchObject({ status: 200 });
  });
  it('caches authenticated viewer across comment refreshes', async () => {
    const { provider, calls } = setup(reviewRoutes);
    await provider.listComments();
    await provider.listComments();
    expect(calls.filter(c => c.url.pathname === '/user')).toHaveLength(1);
  });
  it('resolves a numeric reply ID using its GraphQL thread ID on a cold cache', async () => {
    const { provider, calls } = setup(call => call.body.query?.includes('reviewThreads')
      ? json({ data: { repository: { pullRequest: { reviewThreads: connection([thread('thread-one', connection([comment(101), comment(102)]))]) } } } })
      : reviewRoutes(call));
    await provider.resolveComment(102);
    expect(calls.at(-1)?.body.variables).toEqual({ id: 'thread-one' });
    expect(calls.at(-1)?.body.query).toContain('resolveReviewThread');
  });
  it('rejects conversation resolution without sending a mutation', async () => {
    const { provider, calls } = setup(reviewRoutes);
    await expect(provider.resolveComment(999)).rejects.toMatchObject({ status: 404 });
    expect(calls.filter(c => c.body.query?.startsWith('mutation'))).toHaveLength(0);
  });
  it('posts replies to the top-level REST comment even when the parent is a reply', async () => {
    const { provider, calls } = setup(call => call.body.query?.includes('reviewThreads')
      ? json({ data: { repository: { pullRequest: { reviewThreads: connection([thread('thread-one', connection([comment(101), comment(102)]))]) } } } })
      : reviewRoutes(call));
    expect(await provider.publishComment({ ...roots[0]!, raw: 'reply', parentId: 102, anchorCommit: 'stale' })).toBe(103);
    expect(calls.at(-1)?.url.pathname).toBe('/repos/o/r/pulls/7/comments/101/replies');
    expect(calls.at(-1)?.body).toEqual({ body: 'reply' });
  });
  it('submits roots as one COMMENT review at current head with LEFT and RIGHT anchors', async () => {
    const { provider, calls } = setup(reviewRoutes);
    expect(await provider.publishComments(roots)).toEqual([201, 202]);
    const posts = calls.filter(c => c.init.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[0]?.body).toEqual({ commit_id: 'head', body: '', comments: [
      { body: 'first', path: 'a.ts', line: 3, side: 'RIGHT' }, { body: 'second', path: 'b.ts', line: 4, side: 'LEFT' },
    ] });
    expect(posts[1]?.body).toEqual({ event: 'COMMENT', body: '' });
    expect(calls.map(c => c.url.pathname)).toEqual(['/repos/o/r/pulls/7', '/repos/o/r/pulls/7/reviews',
      '/repos/o/r/pulls/7/reviews/9/comments', '/repos/o/r/pulls/7/reviews/9/events']);
  });
  it('publishes a single root through a submitted review', async () => {
    const { provider } = setup(call => call.url.pathname.endsWith('/reviews/9/comments') ? json([published[0]]) : reviewRoutes(call));
    expect(await provider.publishComment(roots[0]!)).toBe(201);
  });
  it('paginates returned batch IDs in submission order', async () => {
    const { provider } = setup(call => call.url.pathname.endsWith('/reviews/9/comments')
      ? json([published[call.url.searchParams.has('page') ? 1 : 0]],
        call.url.searchParams.has('page') ? {} : { Link: '<https://api.github.com/repos/o/r/pulls/7/reviews/9/comments?page=2>; rel="next"' })
      : reviewRoutes(call));
    expect(await provider.publishComments(roots)).toEqual([201, 202]);
  });
  it('returns IDs in draft order when the API returns comments reversed', async () => {
    const { provider } = setup(call => call.url.pathname.endsWith('/reviews/9/comments') ? json([...published].reverse()) : reviewRoutes(call));
    expect(await provider.publishComments(roots)).toEqual([201, 202]);
  });
  it('consumes each API comment once for identical drafts', async () => {
    const { provider } = setup(call => call.url.pathname.endsWith('/reviews/9/comments')
      ? json([published[0], { ...published[0], id: 202 }]) : reviewRoutes(call));
    expect(await provider.publishComments([roots[0]!, roots[0]!])).toEqual([201, 202]);
  });
  it('cleans up without submitting when returned anchors mismatch', async () => {
    const { provider, calls } = setup(call => call.url.pathname.endsWith('/reviews/9/comments')
      ? json(published.map(c => ({ ...c, line: 99 }))) : reviewRoutes(call));
    await expect(provider.publishComments(roots)).rejects.toMatchObject({ status: 200 });
    expect(calls.at(-1)?.init.method).toBe('DELETE');
    expect(calls.some(c => c.url.pathname.endsWith('/events'))).toBe(false);
  });
  it('rejects mixed batches before any HTTP request', async () => {
    const { provider, calls } = setup(reviewRoutes);
    await expect(provider.publishComments([roots[0]!, { ...roots[1]!, parentId: 101 }])).rejects.toMatchObject({ status: 0 });
    expect(calls).toHaveLength(0);
  });
  it('rejects stale roots before any write', async () => {
    const { provider, calls } = setup(reviewRoutes);
    await expect(provider.publishComments([{ ...roots[0]!, anchorCommit: 'stale' }])).rejects.toMatchObject({ status: 409 });
    expect(calls.filter(c => c.init.method === 'POST')).toHaveLength(0);
  });
  it('returns an empty batch without any HTTP request', async () => {
    const { provider, calls } = setup(reviewRoutes);
    expect(await provider.publishComments([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it.each([401, 403, 404, 422, 429, 500])('preserves HTTP %i status and response body without retrying writes', async status => {
    const { provider, calls } = setup(call => call.init.method === 'POST' ? new Response('rejected', { status }) : reviewRoutes(call));
    await expect(provider.publishComments(roots)).rejects.toMatchObject({ name: 'GitHubError', status, body: 'rejected' });
    expect(calls.filter(c => c.init.method === 'POST')).toHaveLength(1);
  });
  it('rejects GraphQL errors even when HTTP succeeds with partial data', async () => {
    const { provider } = setup(call => call.url.pathname === '/graphql' ? json({ data: {}, errors: [{ message: 'Denied' }] }) : reviewRoutes(call));
    await expect(provider.listComments()).rejects.toMatchObject({ status: 200, body: expect.stringContaining('Denied') });
  });
  it('rejects an inaccessible GraphQL PR', async () => {
    const { provider } = setup(call => call.url.pathname === '/graphql' ? json({ data: { repository: null } }) : reviewRoutes(call));
    await expect(provider.listComments()).rejects.toMatchObject({ status: 404 });
  });
  it('deletes only the newly created pending review when reading IDs fails without submitting', async () => {
    const { provider, calls } = setup(call => call.url.pathname.endsWith('/reviews/9/comments') ? new Response('unavailable', { status: 503 }) : reviewRoutes(call));
    await expect(provider.publishComments(roots)).rejects.toMatchObject({ status: 503, body: 'unavailable' });
    expect(calls.filter(c => c.init.method === 'POST')).toHaveLength(1);
    expect(calls.at(-1)?.init.method).toBe('DELETE');
    expect(calls.at(-1)?.url.pathname).toBe('/repos/o/r/pulls/7/reviews/9');
  });
  it('cleans up a pending review when returned comment counts mismatch', async () => {
    const { provider, calls } = setup(call => call.url.pathname.endsWith('/reviews/9/comments') ? json([]) : reviewRoutes(call));
    await expect(provider.publishComments(roots)).rejects.toMatchObject({ status: 200 });
    expect(calls.at(-1)?.init.method).toBe('DELETE');
  });
  it('reports the pending review ID when cleanup fails', async () => {
    const { provider } = setup(call => call.url.pathname.endsWith('/reviews/9/comments') ? new Response('lookup failed', { status: 503 })
      : call.init.method === 'DELETE' ? new Response('cleanup failed', { status: 403 }) : reviewRoutes(call));
    await expect(provider.publishComments(roots)).rejects.toMatchObject({ status: 403, body: 'cleanup failed', pendingReviewId: 9 });
  });
  it('cleans up an unsubmitted review when submission is rejected', async () => {
    const { provider, calls } = setup(call => call.url.pathname.endsWith('/events') ? new Response('denied', { status: 422 }) : reviewRoutes(call));
    await expect(provider.publishComments(roots)).rejects.toMatchObject({ status: 422, body: 'denied' });
    expect(calls.at(-1)?.init.method).toBe('DELETE');
  });
  it('uses the configured API base without leaking credentials through cross-origin pagination', async () => {
    const fetchFn = Object.assign(async (_input: string | URL | Request) =>
      json([], { Link: '<https://evil.example/next>; rel="next"' }), { preconnect: fetch.preconnect });
    const client = new GitHubClient({ token: 'secret', base: 'https://api.example', fetch: fetchFn });
    await expect(client.findOpenPr('o', 'r', 'b')).rejects.toBeInstanceOf(GitHubError);
  });
});
