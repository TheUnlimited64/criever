import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { WorkspacePullRequest, WorkspaceProject } from '@criever/shared';
import { createDaemon } from '../src/daemon';
import { buildFixtureRepo } from '../fixtures/repo';
import { ME, startReviewStub, type StubPr } from './fixtures/bitbucket-review-stub';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });

const REVIEWER = '{rev}', OTHER = '{other}';
const at = (day: number, hour = 10) => `2026-09-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`;

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'review-filters-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const repo = await buildFixtureRepo(join(root, 'repo'));
  const stub = startReviewStub({ destination: repo.main });
  cleanups.push(async () => stub.stop());
  const env = { HOME: root, CRIEVER_STATE_DIR: join(root, 'state'), CRIEVER_CACHE_DIR: join(root, 'cache'), BITBUCKET_API_BASE: stub.base,
    ATLASSIAN_USER_EMAIL: 'me@example.test', ATLASSIAN_API_TOKEN: 'synthetic-token' };
  const logs: string[] = [];
  let daemon = await createDaemon({ env, cwd: root, staticDir: null, log: m => { logs.push(m); }, pollIntervalMs: 3_600_000 });
  cleanups.push(() => daemon.stop());
  const call = (method: string, path: string, body?: unknown) =>
    daemon.fetch(new Request('http://127.0.0.1:4917' + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const project = async (): Promise<WorkspaceProject> => (await (await call('GET', '/api/workspace')).json()).projects[0];
  const pr = async (id: number): Promise<WorkspacePullRequest> => (await project()).pullRequests.find(row => row.id === id)!;
  const add = async () => (await call('POST', '/api/workspace/projects', { path: repo.root })).json() as Promise<WorkspaceProject>;
  const refresh = async () => (await call('POST', `/api/workspace/projects/${(await project()).id}/refresh`)).json() as Promise<WorkspaceProject>;
  const mark = async (id: number, head: string | null) => (await call('POST', `/api/workspace/projects/${(await project()).id}/prs/${id}/reviewed`, { sourceHead: head })).json() as Promise<WorkspaceProject>;
  const restart = async (between?: () => Promise<void>) => { await daemon.stop(); await between?.(); daemon = await createDaemon({ env, cwd: root, staticDir: null, log: m => { logs.push(m); }, pollIntervalMs: 3_600_000 }); };
  const base = (id: number, extra: Partial<StubPr> = {}): StubPr => ({
    id, head: repo.c3, reviewers: [ME], comments: [],
    commits: [{ hash: repo.c1, date: at(1) }, { hash: repo.c3, date: at(2) }], ...extra,
  });
  return { repo, stub, env, logs, call, project, pr, add, refresh, mark, restart, base, root };
}

describe('Bitbucket review filters', () => {
  it('requests reviewers and participants with encoded plus signs, across pages', async () => {
    const t = await setup();
    t.stub.state.prs = [t.base(1), t.base(2, { reviewers: [] })];
    const stub2 = startReviewStub({ destination: t.repo.main, pageSize: 1 });
    cleanups.push(async () => stub2.stop());
    stub2.state.prs = t.stub.state.prs;
    t.env.BITBUCKET_API_BASE = stub2.base;
    await t.restart(); await t.add();
    const lists = stub2.requests.filter(r => r.path.endsWith('/pullrequests'));
    expect(lists).toHaveLength(2);
    for (const r of lists) {
      expect(r.query).toContain('fields=%2Bvalues.reviewers%2C%2Bvalues.participants');
      expect(r.query).not.toMatch(/fields=\+/);
    }
    expect(lists[0]!.query).toContain('state=OPEN');
    expect((await t.pr(1)).assignedToMe).toBe(true);
    expect((await t.pr(2)).assignedToMe).toBe(false);
    expect((await t.pr(1)).title).toBe('Synthetic change 1');
  });

  it('falls back to PR details when the list still omits reviewer data', async () => {
    const t = await setup();
    t.stub.state.omitReviewerFields = true;
    t.stub.state.prs = [t.base(1), t.base(2, { reviewers: [] })];
    await t.add();
    expect(t.stub.requests.filter(r => /\/pullrequests\/\d+$/.test(r.path)).map(r => r.path.split('/').pop()).sort()).toEqual(['1', '2']);
    expect((await t.pr(1)).assignedToMe).toBe(true);
    expect((await t.pr(1)).pending).toBe(true);
    expect((await t.pr(2)).assignedToMe).toBe(false);
  });

  it('bounds concurrent provider requests', async () => {
    const t = await setup();
    const slow = startReviewStub({ destination: t.repo.main, delayMs: 20 });
    cleanups.push(async () => slow.stop());
    slow.state.omitReviewerFields = true;
    slow.state.prs = Array.from({ length: 14 }, (_, i) => t.base(i + 1));
    t.env.BITBUCKET_API_BASE = slow.base;
    await t.restart(); await t.add();
    expect((await t.project()).pullRequests).toHaveLength(14);
    expect(slow.peak()).toBeLessThanOrEqual(4);
    expect(slow.peak()).toBeGreaterThan(1);
  });

  it('classifies pending, commented, approved and changes-requested assignments', async () => {
    const t = await setup();
    t.stub.state.prs = [
      t.base(1),
      t.base(2, { comments: [{ id: 1, user: ME, at: at(3), inline: true }] }),
      t.base(3, { participants: [{ user: ME, approved: true, state: 'approved', at: at(3) }] }),
      t.base(4, { participants: [{ user: ME, state: 'changes_requested', at: at(3) }] }),
      t.base(5, { participants: [{ user: ME, role: 'REVIEWER' } as never] }),
      t.base(6, { reviewers: [], comments: [{ id: 1, user: ME, at: at(3) }] }),
    ];
    await t.add();
    const rows = await Promise.all([1, 2, 3, 4, 5, 6].map(t.pr));
    expect(rows.map(r => [r.assignedToMe, r.pending, r.status])).toEqual([
      [true, true, 'unreviewed'], [true, false, 'reviewed'], [true, false, 'reviewed'],
      [true, false, 'reviewed'], [true, true, 'unreviewed'], [false, false, 'reviewed'],
    ]);
    expect(rows[2]!.signals!.myDecision).toBe('approved');
    expect(rows[3]!.signals!.myDecision).toBe('changes_requested');
    expect(rows.every(r => r.recheck!.length === 0)).toBe(true);
  });

  it('flags commits pushed after the review on first sync, comparing commit dates', async () => {
    const t = await setup();
    t.stub.state.prs = [
      t.base(1, { comments: [{ id: 1, user: ME, at: at(1, 12) }] }),
      t.base(2, { comments: [{ id: 1, user: ME, at: at(5) }] }),
    ];
    await t.add();
    expect((await t.pr(1)).recheck).toEqual([{ kind: 'commits' }]);
    expect((await t.pr(1)).status).toBe('updated');
    expect((await t.pr(1)).signals!.observedHead).toBe(t.repo.c1);
    expect((await t.pr(2)).status).toBe('reviewed');
    expect((await t.pr(2)).signals!.observedHead).toBe(t.repo.c3);
  });

  it('detects force pushes with older commit dates, across a daemon restart', async () => {
    const t = await setup();
    t.stub.state.prs = [t.base(1, { comments: [{ id: 1, user: ME, at: at(5) }] })];
    await t.add();
    expect((await t.pr(1)).status).toBe('reviewed');
    await t.restart();
    // The branch is force-pushed to a commit whose date predates the review.
    t.stub.state.prs[0]!.head = t.repo.c2;
    t.stub.state.prs[0]!.commits = [{ hash: t.repo.c1, date: at(1) }, { hash: t.repo.c2, date: at(2) }];
    await t.refresh();
    expect((await t.pr(1)).recheck).toEqual([{ kind: 'commits' }]);
    await t.restart();
    expect((await t.pr(1)).status).toBe('updated');
    await t.refresh();
    expect((await t.pr(1)).recheck).toEqual([{ kind: 'commits' }]);
    expect((await t.pr(1)).signals!.observedHead).toBe(t.repo.c3);
  });

  it('resolves abbreviated commit hashes before comparing', async () => {
    const t = await setup();
    t.stub.state.abbreviate = true;
    t.stub.state.prs = [t.base(1, { comments: [{ id: 1, user: ME, at: at(5) }] })];
    await t.add();
    expect((await t.pr(1)).sourceHead).toBe(t.repo.c3);
    expect((await t.pr(1)).signals!.observedHead).toBe(t.repo.c3);
    expect((await t.pr(1)).status).toBe('reviewed');
  });

  it('reports replies in joined threads and independent comments separately, without commit changes', async () => {
    const t = await setup();
    t.stub.state.prs = [t.base(1, { comments: [
      { id: 1, user: ME, at: at(5), inline: true },
      { id: 2, user: REVIEWER, at: at(6), parent: 1 },
      { id: 3, user: OTHER, at: at(7), parent: 2 },
      { id: 4, user: REVIEWER, at: at(8) },
      { id: 5, user: OTHER, at: at(9), parent: 4 },
      { id: 6, user: REVIEWER, at: at(10), deleted: true },
      { id: 7, user: ME, at: at(4) },
    ] })];
    await t.add();
    const row = await t.pr(1);
    expect(row.status).toBe('updated');
    expect(row.recheck).toEqual([
      { kind: 'reply', author: 'Other Person', at: at(7), count: 2 },
      { kind: 'comment', author: 'Other Person', at: at(9), count: 2 },
    ]);
  });

  it('ignores deleted comments, the user\'s own later comments and participant membership', async () => {
    const t = await setup();
    t.stub.state.prs = [
      t.base(1, { comments: [{ id: 1, user: ME, at: at(5) }, { id: 2, user: REVIEWER, at: at(6), deleted: true }, { id: 3, user: ME, at: at(7) }] }),
      t.base(2, { participants: [{ user: ME }] }),
    ];
    await t.add();
    expect((await t.pr(1)).status).toBe('reviewed');
    expect((await t.pr(1)).recheck).toEqual([]);
    expect((await t.pr(2)).status).toBe('unreviewed');
    expect((await t.pr(2)).pending).toBe(true);
    expect((await t.pr(2)).signals!.myActivityAt).toBeNull();
  });

  it('reports other reviewers\' decisions as review feedback', async () => {
    const t = await setup();
    t.stub.state.prs = [t.base(1, {
      comments: [{ id: 1, user: ME, at: at(5) }],
      participants: [{ user: REVIEWER, state: 'changes_requested', at: at(6) }, { user: OTHER, approved: true, state: 'approved', at: at(4) }],
    })];
    await t.add();
    expect((await t.pr(1)).recheck).toEqual([{ kind: 'feedback', author: 'Example Reviewer', at: at(6), count: 1, decision: 'changes_requested' }]);
  });

  it('shows both code and discussion reasons together', async () => {
    const t = await setup();
    t.stub.state.prs = [t.base(1, { comments: [{ id: 1, user: ME, at: at(1, 12) }, { id: 2, user: REVIEWER, at: at(3) }] })];
    await t.add();
    expect((await t.pr(1)).recheck!.map(r => r.kind)).toEqual(['commits', 'comment']);
  });

  it('acknowledges locally without writing to Bitbucket, re-flags new discussion, and clears back to provider state', async () => {
    const t = await setup();
    t.stub.state.prs = [t.base(1, { comments: [{ id: 2, user: REVIEWER, at: at(3) }] }), t.base(2, { comments: [{ id: 1, user: ME, at: at(5) }, { id: 2, user: REVIEWER, at: at(6) }] })];
    await t.add();
    expect((await t.pr(1)).pending).toBe(true);
    const before = t.stub.requests.length;
    await t.mark(1, t.repo.c3);
    const acked = await t.pr(1);
    expect([acked.pending, acked.status, acked.recheck]).toEqual([false, 'reviewed', []]);
    expect(t.stub.requests.slice(before).filter(r => r.method !== 'GET')).toEqual([]);

    // New discussion on the same head needs another acknowledgement.
    t.stub.state.prs[0]!.comments.push({ id: 3, user: OTHER, at: at(8) });
    await t.refresh();
    const again = await t.pr(1);
    expect(again.sourceHead).toBe(acked.sourceHead);
    expect(again.status).toBe('updated');
    expect(again.recheck).toEqual([{ kind: 'comment', author: 'Other Person', at: at(8), count: 1 }]);
    await t.mark(1, t.repo.c3);
    expect((await t.pr(1)).status).toBe('reviewed');

    // Clearing restores provider-derived state: assigned, nothing published, so pending again.
    await t.mark(1, null);
    const cleared = await t.pr(1);
    expect([cleared.pending, cleared.status, cleared.reviewedHead, cleared.reviewedAt]).toEqual([true, 'unreviewed', null, null]);

    // An acknowledgement made while the provider shows a newer comment survives a restart.
    await t.mark(2, t.repo.c3);
    await t.restart();
    expect((await t.pr(2)).status).toBe('reviewed');
    t.stub.state.prs[1]!.head = t.repo.c2;
    await t.refresh();
    expect((await t.pr(2)).recheck!.map(r => r.kind)).toEqual(['commits']);
    expect(t.stub.requests.filter(r => r.method !== 'GET')).toEqual([]);
  });

  it('lets later provider activity supersede an older local acknowledgement', async () => {
    const t = await setup();
    t.stub.state.prs = [t.base(1)];
    await t.add();
    await t.mark(1, t.repo.c3);
    t.stub.state.prs[0]!.head = t.repo.c2;
    t.stub.state.prs[0]!.commits = [{ hash: t.repo.c2, date: at(2) }];
    t.stub.state.prs[0]!.comments.push({ id: 1, user: ME, at: new Date(Date.now() + 60_000).toISOString() });
    await t.refresh();
    const row = await t.pr(1);
    expect([row.status, row.recheck, row.signals!.observedHead]).toEqual(['reviewed', [], t.repo.c2]);
  });

  it('keeps the last successful results and shows the error when the provider fails', async () => {
    const t = await setup();
    t.stub.state.prs = [t.base(1, { comments: [{ id: 1, user: ME, at: at(5) }, { id: 2, user: REVIEWER, at: at(6) }] })];
    await t.add();
    const good = await t.project();
    t.stub.state.failing = true;
    const failed = await t.refresh();
    expect(failed.error).toContain('503');
    expect(failed.pullRequests).toEqual(good.pullRequests);
    t.stub.state.failing = false;
    expect((await t.refresh()).error).toBeNull();
  });

  it('opens workspace state saved before review tracking existed', async () => {
    const t = await setup();
    t.stub.state.prs = [t.base(1, { comments: [{ id: 1, user: REVIEWER, at: at(3) }] })];
    await t.add();
    await t.mark(1, t.repo.c3);
    const file = join(t.env.CRIEVER_STATE_DIR, 'workspace.json');
    await t.restart(async () => {
      const saved = JSON.parse(await readFile(file, 'utf8'));
      for (const row of saved.projects[0].pullRequests) {
        for (const key of ['signals', 'pending', 'recheck', 'reviewedActivityAt', 'reviewedDiscussionThrough']) delete row[key];
      }
      await writeFile(file, JSON.stringify(saved));
    });
    const loaded = await t.pr(1);
    expect([loaded.status, loaded.reviewedHead]).toEqual(['reviewed', t.repo.c3]);
    await t.refresh();
    expect([(await t.pr(1)).status, (await t.pr(1)).recheck]).toEqual(['reviewed', []]);
    t.stub.state.prs[0]!.comments.push({ id: 2, user: OTHER, at: new Date(Date.now() + 60_000).toISOString() });
    await t.refresh();
    expect((await t.pr(1)).recheck!.map(r => r.kind)).toEqual(['comment']);
  });
});
