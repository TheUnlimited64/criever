// Synthetic Bitbucket stub for review-tracking tests: mutable PRs, comments and commits.
export interface StubComment { id: number; user: string; at: string; parent?: number; deleted?: boolean; inline?: boolean }
export interface StubPr {
  id: number; head: string; reviewers: string[]; participants?: { user: string; state?: string | null; approved?: boolean; at?: string }[];
  comments: StubComment[]; commits: { hash: string; date: string }[]; title?: string; destination?: string;
}
export const ME = '{me-uuid}';
export const person = (uuid: string) => ({ display_name: ({ [ME]: 'Example Me', '{rev}': 'Example Reviewer', '{other}': 'Other Person' } as Record<string, string>)[uuid] ?? uuid, uuid });

export function startReviewStub(opts: { destination: string; pageSize?: number; delayMs?: number }) {
  const state = { prs: [] as StubPr[], omitReviewerFields: false, failing: false, abbreviate: false, commitNames: new Map<string, string>() };
  const requests: { method: string; path: string; query: string }[] = [];
  let inflight = 0; let peak = 0;
  const raw = (pr: StubPr, full: boolean) => ({
    id: pr.id, state: 'OPEN', title: pr.title ?? `Synthetic change ${pr.id}`, created_on: '2026-09-01T09:00:00Z', updated_on: '2026-09-01T09:00:00Z',
    author: person('{other}'), links: { html: { href: `https://bitbucket.example/pr/${pr.id}` } },
    source: { branch: { name: `feature/${pr.id}` }, commit: { hash: state.abbreviate ? pr.head.slice(0, 12) : pr.head } },
    destination: { branch: { name: 'main' }, commit: { hash: opts.destination } },
    ...(full ? {
      reviewers: pr.reviewers.map(person),
      participants: [...(pr.participants ?? []).map(p => ({ user: person(p.user), role: 'REVIEWER', approved: p.approved ?? false, state: p.state ?? null, participated_on: p.at ?? null }))],
    } : {}),
  });
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    async fetch(req) {
      const u = new URL(req.url); const p = u.pathname;
      requests.push({ method: req.method, path: p, query: u.search });
      if (state.failing) return Response.json({ error: { message: 'Provider temporarily unavailable' } }, { status: 503 });
      if (p.endsWith('/user')) return Response.json(person(ME));
      const commit = /\/commit\/([0-9a-f]+)$/.exec(p);
      if (commit) {
        const all = [...new Set([opts.destination, ...state.prs.flatMap(pr => [pr.head, ...pr.commits.map(c => c.hash)])])].filter(h => h.startsWith(commit[1]!));
        return all.length === 1 ? Response.json({ hash: all[0] }) : Response.json({ error: 'ambiguous' }, { status: 404 });
      }
      const list = /\/pullrequests$/.test(p);
      const one = /\/pullrequests\/(\d+)$/.exec(p);
      const sub = /\/pullrequests\/(\d+)\/(comments|commits)$/.exec(p);
      inflight++; peak = Math.max(peak, inflight);
      try {
        if (opts.delayMs) await new Promise(r => setTimeout(r, opts.delayMs));
        if (list) {
          // Bitbucket only includes these fields when they are requested with a decoded `+` prefix.
          const wanted = u.searchParams.get('fields') === '+values.reviewers,+values.participants';
          const size = opts.pageSize ?? 50; const page = Number(u.searchParams.get('page') ?? 1);
          const slice = state.prs.slice((page - 1) * size, page * size);
          const more = page * size < state.prs.length;
          const next = new URL(u); next.searchParams.set('page', String(page + 1)); next.searchParams.delete('fields');
          return Response.json({ values: slice.map(pr => raw(pr, wanted && !state.omitReviewerFields)), ...(more ? { next: next.href.replace(/\+/g, '%2B') } : {}) });
        }
        if (one) { const pr = state.prs.find(x => x.id === Number(one[1])); return pr ? Response.json(raw(pr, true)) : Response.json({}, { status: 404 }); }
        if (sub) {
          const pr = state.prs.find(x => x.id === Number(sub[1]))!;
          if (sub[2] === 'commits') return Response.json({ values: [...pr.commits].sort((a, b) => b.date.localeCompare(a.date)).map(c => ({ ...c, message: 'synthetic' })) });
          return Response.json({ values: pr.comments.map(c => ({
            id: c.id, created_on: c.at, deleted: c.deleted ?? false, user: person(c.user), content: { raw: 'synthetic text' },
            ...(c.parent ? { parent: { id: c.parent } } : {}), ...(c.inline ? { inline: { path: 'a.ts', from: null, to: 1 } } : {}),
          })) });
        }
        return Response.json({ error: p }, { status: 404 });
      } finally { inflight--; }
    },
  });
  return { state, requests, base: `${server.url}2.0`, peak: () => peak, stop: () => server.stop(true) };
}
