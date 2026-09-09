type RawComment = Record<string, unknown> & { id: number };
export function startStubBitbucket(opts: { commits: { hash: string; date: string; message: string }[]; main: string; c2: string; c3: string }) {
  const user = (name: string, uuid: string) => ({ display_name: name, uuid });
  const ME = user('Alex Morgan', '{me}'), COLLEAGUE = user('Sam Rivera', '{colleague}'), REVIEWER = user('Riley Chen', '{reviewer}');
  const initial = (): RawComment[] => [
    { id: 301, created_on: '2026-09-03T10:00:00Z', deleted: false, user: ME, content: { raw: 'Use the windowed rows here instead of mapping the full collection, otherwise every item still renders.' }, inline: { path: 'src/devices/DeviceList.tsx', from: null, to: 14 } },
    { id: 302, created_on: '2026-09-05T09:00:00Z', deleted: false, user: COLLEAGUE, parent: { id: 301 }, content: { raw: `Done in ${opts.c3.slice(0, 7)}.` } },
    // A reply to a reply (parent points at 302, not the thread root 301) — regression coverage
    // for the depth-2 nesting behavior where such comments were silently dropped.
    { id: 308, created_on: '2026-09-06T09:00:00Z', deleted: false, user: REVIEWER, parent: { id: 302 }, content: { raw: 'Thanks, confirmed on my end too.' } },
    { id: 303, created_on: '2026-09-02T09:00:00Z', deleted: false, user: COLLEAGUE, content: { raw: 'Nit: import order, hooks before components.' }, inline: { path: 'src/devices/DeviceList.tsx', from: null, to: 1 } },
    { id: 304, created_on: '2026-09-04T09:00:00Z', deleted: false, user: REVIEWER, content: { raw: 'Should the service still accept the page-size option now?' }, inline: { path: 'src/api/devices.ts', from: null, to: 4 } },
    { id: 305, created_on: '2026-09-01T12:00:00Z', deleted: false, user: REVIEWER, content: { raw: 'Pin @tanstack/react-virtual' }, inline: { path: 'package.json', from: null, to: 6 }, resolution: { type: 'comment_resolution' } },
    { id: 306, created_on: '2026-09-01T13:00:00Z', deleted: false, user: REVIEWER, content: { raw: 'Looks good overall' } },
    // Anchored on a file the branch goes on to delete entirely — regression coverage for the
    // "no changes in this range, comment unreachable" case (displayPath survives, displayLine does not).
    { id: 307, created_on: '2026-09-01T09:15:00Z', deleted: false, user: COLLEAGUE, content: { raw: 'Should this be debounced before we drop it?' }, inline: { path: 'src/hooks/useIntersection.ts', from: null, to: 1 } },
    // A colleague's comment that becomes "changed" (its anchor, set explicitly below, predates the
    // PR entirely) — the only fixture case of "changed since <not me>", for the chip wording.
    { id: 309, created_on: '2026-08-31T09:00:00Z', deleted: false, user: COLLEAGUE, content: { raw: 'Why use an infinite query here instead of a plain fetch?' }, inline: { path: 'src/api/devices.ts', from: null, to: 4 } },
  ];
  let comments = initial(); let recorded: unknown[] = []; let nextId = 9000;
  const pr = {
    id: 241, title: 'feat(catalog): virtualize item list', created_on: '2026-09-01T09:00:00Z', author: COLLEAGUE,
    description: '## What\n\nThe catalog view rendered every item on each refresh, even with memoized rows, because the collection reference changed. Switched to a windowed list so only visible items mount.\n\n- Removes the manual paging workaround in `useItems`\n- Keeps refreshes responsive for a large fixture\n- Preserves scroll position across updates\n\nStill calling `/items?pageSize=` server-side, see the inline note on whether that\'s still needed.',
    links: { html: { href: 'https://bitbucket.org/sample-workspace/review-fixture/pull-requests/241' } },
    source: { branch: { name: 'feat/virtual-list-review' }, commit: { hash: opts.c3 } },
    destination: { branch: { name: 'main' }, commit: { hash: opts.main } },
  };
  const json = (o: unknown, status = 200) => Response.json(o, { status });
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    async fetch(req) {
      const u = new URL(req.url); const p = u.pathname;
      if (p === '/__recorded') return json(recorded);
      if (p === '/__reset') { comments = initial(); recorded = []; nextId = 9000; return json({ ok: true }); }
      if (p === '/2.0/user') return json(ME);
      if (p.endsWith('/pullrequests') && u.searchParams.get('q')?.includes('feat/virtual-list-review')) return json({ values: [pr] });
      if (p.endsWith('/pullrequests')) return json({ values: [] });
      if (p.endsWith('/pullrequests/241')) return json(pr);
      if (p.endsWith('/pullrequests/241/commits')) return json({ values: opts.commits });
      if (p.endsWith('/pullrequests/241/comments') && req.method === 'GET') return json({ values: comments });
      if (p.endsWith('/pullrequests/241/comments') && req.method === 'POST') {
        const b = await req.json() as { content: { raw: string }; inline?: unknown; parent?: unknown };
        recorded.push(b);
        if (b.content.raw.includes('FAIL_ME')) return json({ error: { message: 'Comment rejected by stub' } }, 400);
        const c: RawComment = { id: ++nextId, created_on: new Date().toISOString(), deleted: false, user: ME, content: b.content, ...(b.inline ? { inline: b.inline } : {}), ...(b.parent ? { parent: b.parent } : {}) };
        comments.push(c); return json(c, 201);
      }
      const m = /\/comments\/(\d+)\/resolve$/.exec(p);
      if (m && req.method === 'POST') { const c = comments.find(x => x.id === +m[1]!); if (c) c.resolution = { type: 'comment_resolution' }; recorded.push({ resolve: +m[1]! }); return json({}); }
      return json({ error: { message: `stub: no route ${req.method} ${p}` } }, 404);
    },
  });
  return { port: server.port!, base: `http://127.0.0.1:${server.port}/2.0`, recorded: () => recorded, reset: () => { comments = initial(); recorded = []; }, stop: () => server.stop(true) };
}
