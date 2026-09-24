import { join, extname } from 'node:path';
import type { BbComment, ChangedFile, CommentsResponse, DiffResponse, PrCommit, PrInfo, ReviewMeta, Side } from '@criever/shared';
import type { Provider } from './provider';
import type { Git } from './git';
import type { LocalReviewStore } from './localreview';
import type { StateStore } from './state';
import { buildThreads } from './threads';
import { publishDrafts } from './publish';
import { UserError } from './errors';
import type { AiRunner } from './ai';
import { aiEndpoint } from './ai-routes';

export interface ServerDeps {
  git: Git; store: StateStore; provider: Provider;
  ws: string; repo: string; meta: ReviewMeta; mergeBase: string;
  comments: BbComment[]; commits: PrCommit[];
  remote: string;
  staticDir: string | null;
  vscode: { open(path: string, line: number): Promise<string> } | null;
  // Set only when startup carried local review comments over as drafts, so a
  // successful publish can mark the source comment done and stop offering it again.
  localReview?: LocalReviewStore | null;
  ai?: AiRunner;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const err = (message: string, status: number) => json({ error: message }, status);

export function createHandler(d: ServerDeps) {
  const head = () => d.meta.sourceHead;

  const hunksFor = async (anchorCommit: string, path: string) => {
    const f = await d.git.diffFile(anchorCommit, head(), path, 0);
    if (f?.status === 'D') return 'fileDeleted' as const;
    if (!f) return (await d.git.show(head(), path)) == null ? ('fileDeleted' as const) : { hunks: [], newPath: null };
    return { hunks: f.hunks, newPath: f.status === 'R' ? f.newPath : null };
  };

  async function comments(): Promise<CommentsResponse> {
    // A local review's file is the live source of truth and changes under you (the agent writes
    // to it directly) — cheap to re-read per request. A Bitbucket PR only changes when asked
    // (publish/refresh), so it keeps the cached snapshot rather than hitting their API on every poll.
    if (d.provider.kind === 'local') d.comments = await d.provider.listComments();
    // A local comment's own anchorCommit is authoritative — never let buildThreads fall through
    // to inferAnchor() for it. Bitbucket has no localAnchors(), so its anchors map is untouched.
    const anchors = { ...d.store.state.anchors, ...(await d.provider.localAnchors?.() ?? {}) };
    const { threads, newAnchors } = await buildThreads(d.comments, anchors, d.commits, hunksFor);
    for (const [id, a] of Object.entries(newAnchors)) await d.store.setAnchor(+id, a);
    return { threads, drafts: d.store.state.drafts };
  }

  async function files(rangeBase: string, rangeHead: string): Promise<ChangedFile[]> {
    const [diffs, { threads }] = await Promise.all([d.git.changedFiles(rangeBase, rangeHead), comments()]);
    return Promise.all(diffs.map(async f => {
      const path = f.newPath ?? f.oldPath!;
      const v = d.store.state.viewed[path];
      const th = threads.filter(t => t.displayPath === path && !t.root.resolved);
      return {
        path, oldPath: f.oldPath, status: f.status, additions: f.additions, deletions: f.deletions,
        // viewed/threads are anchored to the review head, not to whatever sub-range is being browsed
        viewed: v ? await d.git.isUnchanged(v, head(), path) : false,
        draftCount: d.store.state.drafts.filter(x => x.path === path).length,
        changedCount: th.filter(t => t.status?.status === 'changed' || t.status?.status === 'deleted').length,
        openCount: th.filter(t => t.status?.status !== 'changed' && t.status?.status !== 'deleted').length,
      };
    }));
  }

  async function prInfo(): Promise<PrInfo> {
    const localHead = (await d.git.run(['rev-parse', 'HEAD'])).stdout.trim();
    return {
      id: d.meta.id, title: d.meta.title, url: d.meta.url, author: d.meta.author, description: d.meta.description, kind: d.provider.kind,
      sourceBranch: d.meta.sourceBranch, destinationBranch: d.meta.destinationBranch,
      sourceHead: head(), destinationHead: d.meta.destinationHead, mergeBase: d.mergeBase,
      commits: d.commits, lastSeenHead: d.store.state.lastSeenHead ?? null,
      localBehind: await d.git.revListCount(localHead, head()), stateWarning: d.store.warning,
    };
  }

  async function serveStatic(pathname: string): Promise<Response> {
    if (!d.staticDir) return err('not found', 404);
    const rel = pathname === '/' ? '/index.html' : pathname;
    if (d.staticDir === 'embedded') {
      // Base64 map generated at build time, simplest way to embed a whole Vite dist/ into a Bun --compile binary
      let WEB_ASSETS: Record<string, string>;
      try {
        ({ WEB_ASSETS } = await import('./web-assets'));
      } catch {
        return err('UI bundle not embedded, run `bun run build` first', 404);
      }
      const b64 = WEB_ASSETS[rel] ?? WEB_ASSETS['/index.html'];
      if (b64 == null) return err('not found', 404);
      return new Response(Buffer.from(b64, 'base64'), { headers: { 'content-type': Bun.file(rel).type } });
    }
    let f = Bun.file(join(d.staticDir, rel));
    if (!(await f.exists()) || !extname(rel)) f = Bun.file(join(d.staticDir, 'index.html'));
    return new Response(f);
  }

  return async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url); const p = url.pathname; const q = url.searchParams;
    const body = async <T,>() => (await req.json()) as T;
    try {
      if (!p.startsWith('/api/')) return serveStatic(p);
      if (p.startsWith('/api/ai/') && req.method !== 'GET' && req.headers.has('origin') && req.headers.get('origin') !== url.origin) return err('cross-origin AI request rejected', 403);
      if (p.startsWith('/api/ai/') && (p === '/api/ai/chat' || p === '/api/ai/review' || p.endsWith('/reword') || req.method === 'PATCH') && !req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return err('JSON content type required', 415);
      if (d.ai) {
        const aiResponse = await aiEndpoint(req, p, { adapter: d.ai, store: d.store, git: d.git, meta: d.meta, base: d.mergeBase });
        if (aiResponse) return aiResponse;
      }
      if (req.method === 'GET') {
        if (p === '/api/pr') return json(await prInfo());
        if (p === '/api/files') return json(await files(q.get('base') ?? d.mergeBase, q.get('head') ?? head()));
        if (p === '/api/tree') return json((await d.git.lsTree(q.get('at') ?? head())).map(path => ({ path })));
        if (p === '/api/diff') {
          const path = q.get('path'); if (!path) return err('path required', 400);
          const base = q.get('base') ?? d.mergeBase, h = q.get('head') ?? head(), context = +(q.get('context') ?? 3);
          const res: DiffResponse = { file: await d.git.diffFile(base, h, path, context), base, head: h, context };
          return json(res);
        }
        if (p === '/api/file') {
          const path = q.get('path'); if (!path) return err('path required', 400);
          const at = q.get('at') ?? head();
          return json({ path, at, content: await d.git.show(at, path) });
        }
        if (p === '/api/search') {
          const s = q.get('q')?.trim(); if (!s) return err('q required', 400);
          return json(await d.git.grep(q.get('at') ?? head(), s));
        }
        if (p === '/api/comments') return json(await comments());
      }
      if (req.method === 'POST' && p === '/api/drafts') {
        const b = await body<{ path: string; line: number; side: Side; body: string; parentId?: number }>();
        if (!b.path || !b.line || !b.side || typeof b.body !== 'string') return err('path, line, side, body required', 400);
        return json(await d.store.addDraft({ path: b.path, line: b.line, side: b.side, body: b.body, anchorCommit: head(), ...(b.parentId != null ? { parentId: b.parentId } : {}) }));
      }
      const draftM = /^\/api\/drafts\/([^/]+)$/.exec(p);
      if (draftM && req.method === 'PATCH') { const r = await d.store.updateDraft(draftM[1]!, (await body<{ body: string }>()).body); return r ? json(r) : err('draft not found', 404); }
      if (draftM && req.method === 'DELETE') return (await d.store.removeDraft(draftM[1]!)) ? json({ ok: true }) : err('draft not found', 404);

      if (req.method === 'POST' && p === '/api/publish') {
        // Snapshotted before the generator removes drafts as it publishes them, so a successful
        // result can still be traced back to the local comment it was carried over from.
        const sourceLocalIds = new Map(d.store.state.drafts.map(dr => [dr.id, dr.sourceLocalId] as const));
        const gen = publishDrafts(d.store, dr => d.provider.publishComment({ raw: dr.body, path: dr.path, line: dr.line, side: dr.side, parentId: dr.parentId }));
        const stream = new ReadableStream({
          async start(ctrl) {
            for await (const r of gen) {
              const sourceLocalId = r.ok ? sourceLocalIds.get(r.draftId) : undefined;
              if (sourceLocalId != null && d.localReview) await d.localReview.markPublished(sourceLocalId, d.meta.id, r.commentId!);
              ctrl.enqueue(new TextEncoder().encode(JSON.stringify(r) + '\n'));
            }
            d.comments = await d.provider.listComments().catch(() => d.comments);
            ctrl.close();
          },
        });
        return new Response(stream, { headers: { 'content-type': 'application/x-ndjson' } });
      }
      const resolveM = /^\/api\/comments\/(\d+)\/resolve$/.exec(p);
      if (resolveM && req.method === 'POST') {
        const id = +resolveM[1]!;
        await d.provider.resolveComment(id);
        const c = d.comments.find(x => x.id === id); if (c) c.resolved = true;
        return json({ ok: true });
      }
      if (req.method === 'POST' && p === '/api/viewed') {
        const b = await body<{ path: string; viewed: boolean }>();
        await d.store.setViewed(b.path, b.viewed ? head() : null); return json({ ok: true });
      }
      if (req.method === 'POST' && p === '/api/seen') { await d.store.setLastSeenHead(head()); return json({ ok: true }); }
      if (req.method === 'POST' && p === '/api/refresh') {
        d.meta = await d.provider.meta();
        await d.git.fetch(d.remote, [d.meta.sourceBranch, d.meta.destinationBranch]).catch(() => {});
        d.mergeBase = await d.git.mergeBase(d.meta.destinationHead, head());
        [d.comments, d.commits] = await Promise.all([d.provider.listComments(), d.provider.listCommits()]);
        return json({ ok: true });
      }
      if (req.method === 'POST' && p === '/api/vscode/open') {
        if (!d.vscode) return err('VS Code integration unavailable in this build', 501);
        const b = await body<{ path: string; line: number }>();
        return json({ url: await d.vscode.open(b.path, b.line ?? 1) });
      }
      return err('not found', 404);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(msg, e instanceof UserError ? 400 : 500);
    }
  };
}
