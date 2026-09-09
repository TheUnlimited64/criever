import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BitbucketClient, BitbucketError } from '../src/bitbucket';

const fx = (n: string) => readFileSync(new URL(`./fixtures/bitbucket/${n}.json`, import.meta.url), 'utf8');
type Call = { url: string; init?: RequestInit };

function fakeFetch(routes: Record<string, (init?: RequestInit) => Response>, calls: Call[] = []) {
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    for (const [k, h] of Object.entries(routes)) if (url.includes(k)) return h(init);
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (s: string, status = 200) => () => new Response(s, { status, headers: { 'content-type': 'application/json' } });
const BASE = 'https://api.example/2.0';
const mk = (routes: Record<string, (init?: RequestInit) => Response>) => {
  const { f, calls } = fakeFetch({ '/2.0/user': json('{"uuid":"{me}","display_name":"Alex Morgan"}'), ...routes });
  return { c: new BitbucketClient({ base: BASE, email: 'e', token: 't', fetch: f }), calls };
};

describe('BitbucketClient', () => {
  it('sends basic auth and the q filter; picks newest PR', async () => {
    const { c, calls } = mk({ '/pullrequests?': json(fx('pr')) });
    const pr = await c.findOpenPr('sample-workspace', 'review-fixture', 'feat/virtual-list-review');
    expect(pr!.id).toBe(241);
    const call = calls.find(x => x.url.includes('/pullrequests?'))!;
    expect(decodeURIComponent(call.url)).toContain('q=source.branch.name="feat/virtual-list-review" AND state="OPEN"');
    expect((call.init!.headers as Record<string, string>)['Authorization']).toBe('Basic ' + Buffer.from('e:t').toString('base64'));
  });
  it('returns null when no PR', async () => {
    const { c } = mk({ '/pullrequests?': json('{"values":[]}') });
    expect(await c.findOpenPr('w', 'r', 'b')).toBeNull();
  });
  it('lists comments across pages, maps fields, drops deleted and non-inline roots? no: keeps them, marks deleted', async () => {
    const { c } = mk({ 'comments?page=2': json(fx('comments-page2')), '/comments': json(fx('comments-page1')) });
    const cs = await c.listComments('w', 'r', 241);
    expect(cs.map(x => x.id)).toEqual([301, 302, 309, 310, 311]);
    expect(cs[0]).toEqual({
      id: 301, parentId: null, author: { name: 'Alex Morgan', initials: 'AM', isMe: true },
      createdOn: '2026-09-03T10:00:00Z', body: 'Use the windowed rows here instead of mapping the full collection.',
      resolved: false, deleted: false, inline: { path: 'src/devices/DeviceList.tsx', from: null, to: 40 },
    });
    expect(cs[1]!.parentId).toBe(301);
    expect(cs[2]!.resolved).toBe(true);
    expect(cs[3]!.deleted).toBe(true);
    expect(cs[4]!.inline).toBeNull();
    expect(cs[2]!.author.isMe).toBe(false);
  });
  it('lists commits', async () => {
    const { c } = mk({ '/commits': json(fx('commits')) });
    expect(await c.listCommits('w', 'r', 241)).toEqual([
      { hash: 'c0ffee1', date: '2026-09-05T08:00:00+00:00', message: 'render visible items' },
      { hash: 'c0ffee2', date: '2026-09-02T08:00:00+00:00', message: 'wire windowed rows' },
      { hash: 'c0ffee3', date: '2026-09-01T08:00:00+00:00', message: 'add row helper' },
    ]);
  });
  it('publishes new-side, old-side and reply comments with the right body', async () => {
    const { c, calls } = mk({ '/comments': json('{"id": 9001}', 201) });
    expect(await c.publishComment('w', 'r', 241, { raw: 'hi', path: 'a.ts', line: 5, side: 'new' })).toBe(9001);
    await c.publishComment('w', 'r', 241, { raw: 'old', path: 'a.ts', line: 7, side: 'old' });
    await c.publishComment('w', 'r', 241, { raw: 're', path: 'a.ts', line: 5, side: 'new', parentId: 301 });
    const bodies = calls.filter(x => x.init?.method === 'POST').map(x => JSON.parse(x.init!.body as string));
    expect(bodies[0]).toEqual({ content: { raw: 'hi' }, inline: { path: 'a.ts', to: 5 } });
    expect(bodies[1]).toEqual({ content: { raw: 'old' }, inline: { path: 'a.ts', from: 7 } });
    expect(bodies[2]).toEqual({ content: { raw: 're' }, inline: { path: 'a.ts', to: 5 }, parent: { id: 301 } });
  });
  it('resolve posts to /resolve', async () => {
    const { c, calls } = mk({ '/resolve': json('{}') });
    await c.resolveComment('w', 'r', 241, 301);
    expect(calls.at(-1)!.url).toBe(`${BASE}/repositories/w/r/pullrequests/241/comments/301/resolve`);
    expect(calls.at(-1)!.init!.method).toBe('POST');
  });
  it('sends no Content-Type on bodyless POSTs (Bitbucket 400s on an empty JSON body)', async () => {
    const { c, calls } = mk({ '/resolve': json('{}'), '/comments': json('{"id": 3001}', 201) });
    await c.resolveComment('w', 'r', 241, 301);
    const resolve = calls.at(-1)!;
    expect(resolve.init!.body).toBeUndefined();
    expect((resolve.init!.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    await c.publishComment('w', 'r', 241, { raw: 'hi', path: 'a.ts', line: 5, side: 'new' });
    const post = calls.at(-1)!;
    expect((post.init!.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
  it('throws BitbucketError with status and body on 4xx', async () => {
    const { c } = mk({ '/pullrequests?': json('{"error":{"message":"Token rejected"}}', 401) });
    await expect(c.findOpenPr('w', 'r', 'b')).rejects.toMatchObject({ status: 401, message: expect.stringMatching(/ATLASSIAN_API_TOKEN/) });
  });
  it('retries once on 429 honouring Retry-After', async () => {
    let n = 0;
    const { c } = mk({ '/commits': () => { n++; return n === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '0' } }) : new Response(fx('commits')); } });
    expect((await c.listCommits('w', 'r', 1)).length).toBe(3); expect(n).toBe(2);
  });
});
