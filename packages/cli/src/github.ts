import type { Anchor, BbComment, PrCommit, ReviewMeta } from '@criever/shared';
import type { PublishBody } from './provider';

export interface RawGitHubPr {
  state?: string; draft?: boolean; updated_at?: string;
  requested_reviewers?: { login: string }[];
  requested_teams?: { id: number }[];
  number: number; title: string; body: string | null; html_url: string; created_at: string;
  user: { login: string } | null;
  head: { ref: string; sha: string }; base: { ref: string; sha: string };
}
interface Connection<T> { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
interface ReviewComment {
  fullDatabaseId: string | number | null; body: string; createdAt: string; author: { login: string } | null;
  path: string; originalLine: number | null; originalCommit: { oid: string } | null;
}
interface ReviewThread { id: string; isResolved: boolean; diffSide: 'LEFT' | 'RIGHT'; comments: Connection<ReviewComment> }
interface IssueComment { id: number; body: string; created_at: string; user: { login: string } | null }

export class GitHubError extends Error {
  constructor(public status: number, public body: string, message: string, public pendingReviewId?: number) {
    super(message); this.name = 'GitHubError';
  }
}

const fields = `comments(first:100, after:$commentCursor) {
  nodes { fullDatabaseId body createdAt author { login } path originalLine originalCommit { oid } }
  pageInfo { hasNextPage endCursor }
}`;
const threadQuery = `query($owner:String!, $repo:String!, $number:Int!, $cursor:String, $commentCursor:String) {
  repository(owner:$owner, name:$repo) { pullRequest(number:$number) {
    reviewThreads(first:100, after:$cursor) { nodes { id isResolved diffSide ${fields} } pageInfo { hasNextPage endCursor } }
  } }
}`;
const commentQuery = `query($id:ID!, $commentCursor:String) { node(id:$id) {
  ... on PullRequestReviewThread { ${fields} }
} }`;
const initials = (name: string) => name.split(/[\s-]+/).map(p => p[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';
const prPath = (owner: string, repo: string, id?: number) =>
  `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls${id == null ? '' : `/${id}`}`;

export function githubPrToMeta(pr: RawGitHubPr): ReviewMeta {
  return {
    id: pr.number, title: pr.title, description: pr.body?.trim() || null, url: pr.html_url,
    author: pr.user?.login ?? 'ghost', sourceBranch: pr.head.ref, sourceHead: pr.head.sha,
    destinationBranch: pr.base.ref, destinationHead: pr.base.sha,
  };
}

export class GitHubClient {
  private fetchFn: typeof fetch; private token: string; private base: string; private me: Promise<string> | null = null;
  private threads = new Map<string, Map<number, { threadId: string; rootId: number }>>();
  constructor(opts: { token: string; fetch?: typeof fetch; base?: string }) {
    this.token = opts.token; this.fetchFn = opts.fetch ?? fetch; this.base = opts.base ?? 'https://api.github.com';
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const full = new URL(url, this.base);
    if (full.origin !== new URL(this.base).origin) throw new GitHubError(0, url, 'Refusing to send GitHub credentials outside the configured API origin.');
    const res = await this.fetchFn(full.href, { ...init, headers: {
      Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10',
      ...(init.body != null ? { 'Content-Type': 'application/json' } : {}),
    } });
    if (!res.ok) {
      const body = await res.text();
      throw new GitHubError(res.status, body, `GitHub returned ${res.status}. Check GITHUB_TOKEN (or ~/.config/criever/config.json) and repository permissions; use --local for a local review.\n${body.slice(0, 500)}`);
    }
    return res;
  }
  private async req<T>(url: string, init: RequestInit = {}): Promise<T> {
    return (await this.request(url, init)).json();
  }
  private async all<T>(url: string): Promise<T[]> {
    const out: T[] = []; let next: string | undefined = url;
    while (next) {
      const res = await this.request(next);
      out.push(...await res.json() as T[]);
      next = res.headers.get('Link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    }
    return out;
  }
  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const result = await this.req<{ data?: T; errors?: { message: string }[] }>('/graphql', {
      method: 'POST', body: JSON.stringify({ query, variables }),
    });
    if (result.errors?.length || !result.data) {
      const body = JSON.stringify(result);
      throw new GitHubError(200, body, `GitHub GraphQL failed. Check GITHUB_TOKEN and repository permissions; use --local for a local review.\n${body.slice(0, 500)}`);
    }
    return result.data;
  }
  async findOpenPr(owner: string, repo: string, branch: string): Promise<ReviewMeta | null> {
    const prs = await this.all<RawGitHubPr>(`${prPath(owner, repo)}?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=100`);
    const pr = prs.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return pr ? githubPrToMeta(pr) : null;
  }
  async getPr(owner: string, repo: string, id: number): Promise<ReviewMeta> {
    return githubPrToMeta(await this.req<RawGitHubPr>(prPath(owner, repo, id)));
  }
  async listOpenPrs(owner: string, repo: string) {
    const [prs, me] = await Promise.all([
      this.all<RawGitHubPr>(`${prPath(owner, repo)}?state=open&per_page=100`),
      this.req<{ login: string }>('/user'),
    ]);
    let teams: { id: number }[] = [];
    if (prs.some(p => p.requested_teams?.length)) {
      try { teams = await this.all<{ id: number }>('/user/teams?per_page=100'); }
      catch (e) { if (!(e instanceof GitHubError) || (e.status !== 403 && e.status !== 404)) throw e; }
    }
    return prs.map(pr => ({
      ...githubPrToMeta(pr), draft: pr.draft ?? false, updatedAt: pr.updated_at ?? pr.created_at,
      assignedToMe: !!pr.requested_reviewers?.some(u => u.login.toLowerCase() === me.login.toLowerCase())
        || !!pr.requested_teams?.some(t => teams.some(m => m.id === t.id)),
    }));
  }
  async getOpenPr(owner: string, repo: string, id: number): Promise<ReviewMeta> {
    const pr = await this.req<RawGitHubPr>(prPath(owner, repo, id));
    if (pr.state !== 'open') throw new GitHubError(409, '', 'Pull request is no longer open.');
    return githubPrToMeta(pr);
  }
  async listCommits(owner: string, repo: string, id: number): Promise<PrCommit[]> {
    const commits = await this.all<{ sha: string; commit: { message: string; committer: { date: string } } }>(`${prPath(owner, repo, id)}/commits?per_page=100`);
    return commits.reverse().map(c => ({ hash: c.sha, date: c.commit.committer.date, message: c.commit.message }));
  }
  async listComments(owner: string, repo: string, id: number): Promise<BbComment[]> {
    const key = prPath(owner, repo, id);
    const [me, conversation] = await Promise.all([
      (this.me ??= this.req<{ login: string }>('/user').then(u => u.login)),
      this.all<IssueComment>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${id}/comments?per_page=100`),
    ]);
    const out: BbComment[] = []; const mapping = new Map<number, { threadId: string; rootId: number }>();
    let cursor: string | null = null;
    do {
      const data: { repository: { pullRequest: { reviewThreads: Connection<ReviewThread> } | null } | null } =
        await this.graphql(threadQuery, { owner, repo, number: id, cursor, commentCursor: null });
      const page = data.repository?.pullRequest?.reviewThreads;
      if (!page) throw new GitHubError(404, JSON.stringify(data), 'GitHub pull request is unavailable. Check GITHUB_TOKEN and repository access, or use --local.');
      for (const thread of page.nodes) {
        const comments = [...thread.comments.nodes]; let nested = thread.comments.pageInfo;
        while (nested.hasNextPage) {
          const more: { node: { comments: Connection<ReviewComment> } } =
            await this.graphql(commentQuery, { id: thread.id, commentCursor: nested.endCursor });
          comments.push(...more.node.comments.nodes); nested = more.node.comments.pageInfo;
        }
        const numeric = comments.map(c => {
          const databaseId = Number(c.fullDatabaseId);
          if (!Number.isSafeInteger(databaseId) || databaseId <= 0) throw new GitHubError(200, JSON.stringify(c), 'GitHub review comment ID cannot be represented safely as a numeric ID.');
          return { ...c, databaseId };
        });
        const root = numeric[0];
        if (!root) continue;
        for (const c of numeric) {
          mapping.set(c.databaseId, { threadId: thread.id, rootId: root.databaseId });
          const side = thread.diffSide === 'LEFT' ? 'old' : 'new';
          const anchor: Anchor | undefined = c.originalLine != null && c.originalCommit
            ? { path: c.path, line: c.originalLine, side, anchorCommit: c.originalCommit.oid, source: 'provider' } : undefined;
          const name = c.author?.login ?? 'ghost';
          out.push({
            id: c.databaseId, parentId: c === root ? null : root.databaseId, body: c.body, createdOn: c.createdAt,
            author: { name, initials: initials(name), isMe: name.toLowerCase() === me.toLowerCase() },
            resolved: thread.isResolved, deleted: false,
            inline: c.originalLine == null ? null : { path: c.path, from: side === 'old' ? c.originalLine : null, to: side === 'new' ? c.originalLine : null },
            ...(c.originalLine == null ? { filePath: c.path } : {}),
            ...(anchor ? { anchor } : {}),
          });
        }
      }
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor);
    this.threads.set(key, mapping);
    for (const c of conversation) {
      const name = c.user?.login ?? 'ghost';
      out.push({ id: c.id, parentId: null, body: c.body, createdOn: c.created_at,
        author: { name, initials: initials(name), isMe: name.toLowerCase() === me.toLowerCase() },
        resolved: false, deleted: false, inline: null, canResolve: false, canReply: false });
    }
    return out;
  }
  async publishComments(owner: string, repo: string, id: number, bodies: PublishBody[]): Promise<number[]> {
    if (!bodies.length) return [];
    if (bodies.some(b => b.parentId != null)) throw new GitHubError(0, '', 'GitHub batches accept roots only; publish replies sequentially.');
    const pr = await this.getPr(owner, repo, id);
    if (bodies.some(b => b.anchorCommit != null && b.anchorCommit !== pr.sourceHead)) {
      throw new GitHubError(409, '', 'GitHub PR head changed since this inline draft was anchored. Refresh and re-anchor before publishing, or use --local.');
    }
    const path = prPath(owner, repo, id);
    const review = await this.req<{ id: number }>(`${path}/reviews`, { method: 'POST', body: JSON.stringify({
      commit_id: pr.sourceHead, body: '',
      comments: bodies.map(b => ({ body: b.raw, path: b.path, line: b.line, side: b.side === 'old' ? 'LEFT' : 'RIGHT' })),
    }) });
    try {
      const comments = await this.all<{ id: number; body: string; path: string; line: number; side: 'LEFT' | 'RIGHT' }>(`${path}/reviews/${review.id}/comments?per_page=100`);
      if (comments.length !== bodies.length) throw new GitHubError(200, JSON.stringify(comments), 'GitHub returned an unexpected review comment count.');
      const remaining = [...comments];
      const ids = bodies.map(b => {
        const index = remaining.findIndex(c => c.body === b.raw && c.path === b.path && c.line === b.line && c.side === (b.side === 'old' ? 'LEFT' : 'RIGHT'));
        const match = index < 0 ? undefined : remaining.splice(index, 1)[0];
        if (!match) throw new GitHubError(200, JSON.stringify(comments), 'GitHub review comments did not match the submitted drafts.');
        return match.id;
      });
      await this.req(`${path}/reviews/${review.id}/events`, { method: 'POST', body: JSON.stringify({ event: 'COMMENT', body: '' }) });
      return ids;
    } catch (error) {
      try {
        await this.request(`${path}/reviews/${review.id}`, { method: 'DELETE' });
      } catch (cleanup) {
        if (!(cleanup instanceof Error)) throw cleanup;
        throw new GitHubError(cleanup instanceof GitHubError ? cleanup.status : 0, cleanup instanceof GitHubError ? cleanup.body : '',
          `GitHub review ${review.id} could not be cleaned up; it may be pending or submitted. Do not republish until its state is checked.\n${cleanup.message}`, review.id);
      }
      throw error;
    }
  }
  async publishComment(owner: string, repo: string, id: number, body: PublishBody): Promise<number> {
    if (body.parentId != null) {
      let mapping = this.threads.get(prPath(owner, repo, id));
      if (!mapping?.has(body.parentId)) { await this.listComments(owner, repo, id); mapping = this.threads.get(prPath(owner, repo, id)); }
      const parent = mapping?.get(body.parentId);
      if (!parent) throw new GitHubError(404, '', 'GitHub reply parent is not a review thread comment.');
      const reply = await this.req<{ id: number }>(`${prPath(owner, repo, id)}/comments/${parent.rootId}/replies`, { method: 'POST', body: JSON.stringify({ body: body.raw }) });
      mapping?.set(reply.id, parent);
      return reply.id;
    }
    const ids = await this.publishComments(owner, repo, id, [body]);
    const result = ids[0];
    if (result == null) throw new GitHubError(200, '', 'GitHub review returned no comment ID.');
    return result;
  }
  async resolveComment(owner: string, repo: string, id: number, commentId: number): Promise<void> {
    const key = prPath(owner, repo, id);
    if (!this.threads.get(key)?.has(commentId)) await this.listComments(owner, repo, id);
    const thread = this.threads.get(key)?.get(commentId);
    if (!thread) throw new GitHubError(404, '', 'GitHub comment is not a resolvable review thread (conversation comments cannot be resolved).');
    await this.graphql(`mutation($id:ID!) { resolveReviewThread(input:{threadId:$id}) { thread { id isResolved } } }`, { id: thread.threadId });
  }
}
