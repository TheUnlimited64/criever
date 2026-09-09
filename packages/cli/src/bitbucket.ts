import type { BbComment, PrCommit, Side } from '@criever/shared';

export interface RawPr {
  id: number; title: string; created_on: string; description?: string;
  author: { display_name: string; uuid: string };
  links: { html: { href: string } };
  source: { branch: { name: string }; commit: { hash: string } };
  destination: { branch: { name: string }; commit: { hash: string } };
}
interface RawComment {
  id: number; created_on: string; deleted: boolean; parent?: { id: number };
  user: { display_name: string; uuid: string }; content: { raw: string };
  inline?: { path: string; from: number | null; to: number | null }; resolution?: unknown;
}
interface Page<T> { values: T[]; next?: string }

export class BitbucketError extends Error {
  constructor(public status: number, public body: string, message: string) { super(message); this.name = 'BitbucketError'; }
}

const initials = (name: string) => name.split(/\s+/).map(p => p[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';

export class BitbucketClient {
  private auth: string; private fetchFn: typeof fetch; private base: string; private me: Promise<string> | null = null;
  constructor(opts: { base: string; email: string; token: string; fetch?: typeof fetch }) {
    this.base = opts.base.replace(/\/$/, '');
    this.auth = 'Basic ' + Buffer.from(`${opts.email}:${opts.token}`).toString('base64');
    this.fetchFn = opts.fetch ?? fetch;
  }

  private async req<T>(url: string, init: RequestInit = {}, retried = false): Promise<T> {
    const full = url.startsWith('http') ? url : this.base + url;
    // Only declare a JSON body when there is one: Bitbucket answers 400 Bad Request to a POST
    // that carries `Content-Type: application/json` with an empty body (e.g. .../resolve).
    const res = await this.fetchFn(full, { ...init, headers: { Authorization: this.auth, Accept: 'application/json', ...(init.body != null ? { 'Content-Type': 'application/json' } : {}), ...(init.headers as Record<string, string> | undefined) } });
    if (res.status === 429 && !retried) {
      const wait = Math.min(+(res.headers.get('Retry-After') ?? '5'), 60) * 1000;
      await new Promise(r => setTimeout(r, wait));
      return this.req<T>(url, init, true);
    }
    if (!res.ok) {
      const body = await res.text();
      const hint = res.status === 401 || res.status === 403
        ? 'Bitbucket rejected the credentials. Check ATLASSIAN_API_TOKEN and ATLASSIAN_USER_EMAIL (or ~/.config/criever/config.json).'
        : `Bitbucket returned ${res.status} for ${full}`;
      throw new BitbucketError(res.status, body, `${hint}\n${body.slice(0, 500)}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  private async all<T>(url: string): Promise<T[]> {
    const out: T[] = []; let next: string | undefined = url;
    while (next) { const page: Page<T> = await this.req<Page<T>>(next); out.push(...page.values); next = page.next; }
    return out;
  }

  private myUuid(): Promise<string> {
    return (this.me ??= this.req<{ uuid: string }>('/user').then(u => u.uuid));
  }

  async findOpenPr(ws: string, repo: string, branch: string): Promise<RawPr | null> {
    const q = encodeURIComponent(`source.branch.name="${branch}" AND state="OPEN"`);
    const page = await this.req<Page<RawPr>>(`/repositories/${ws}/${repo}/pullrequests?q=${q}&pagelen=50`);
    return [...page.values].sort((a, b) => b.created_on.localeCompare(a.created_on))[0] ?? null;
  }

  getPr(ws: string, repo: string, id: number): Promise<RawPr> {
    return this.req<RawPr>(`/repositories/${ws}/${repo}/pullrequests/${id}`);
  }

  async listComments(ws: string, repo: string, id: number): Promise<BbComment[]> {
    const [raw, me] = await Promise.all([this.all<RawComment>(`/repositories/${ws}/${repo}/pullrequests/${id}/comments?pagelen=100`), this.myUuid()]);
    return raw.map(c => ({
      id: c.id, parentId: c.parent?.id ?? null,
      author: { name: c.user.display_name, initials: initials(c.user.display_name), isMe: c.user.uuid === me },
      createdOn: c.created_on, body: c.content.raw, resolved: c.resolution != null, deleted: c.deleted,
      inline: c.inline ? { path: c.inline.path, from: c.inline.from ?? null, to: c.inline.to ?? null } : null,
    }));
  }

  async listCommits(ws: string, repo: string, id: number): Promise<PrCommit[]> {
    const raw = await this.all<{ hash: string; date: string; message: string }>(`/repositories/${ws}/${repo}/pullrequests/${id}/commits?pagelen=100`);
    return raw.map(c => ({ hash: c.hash, date: c.date, message: c.message }));
  }

  async publishComment(ws: string, repo: string, id: number, b: { raw: string; path: string; line: number; side: Side; parentId?: number }): Promise<number> {
    const body: Record<string, unknown> = {
      content: { raw: b.raw },
      inline: b.side === 'new' ? { path: b.path, to: b.line } : { path: b.path, from: b.line },
    };
    if (b.parentId != null) body.parent = { id: b.parentId };
    const r = await this.req<{ id: number }>(`/repositories/${ws}/${repo}/pullrequests/${id}/comments`, { method: 'POST', body: JSON.stringify(body) });
    return r.id;
  }

  async resolveComment(ws: string, repo: string, id: number, commentId: number): Promise<void> {
    await this.req(`/repositories/${ws}/${repo}/pullrequests/${id}/comments/${commentId}/resolve`, { method: 'POST' });
  }
}
