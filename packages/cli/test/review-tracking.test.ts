import { describe, expect, it } from 'vitest';
import type { BbComment, WorkspacePullRequest } from '@criever/shared';
import { deriveReview, describeRecheck } from '@criever/shared';
import { discussionFrom } from '../src/review-signals';
import { BitbucketClient } from '../src/bitbucket';
import { mapLimit } from '../src/concurrency';

const row = (extra: Partial<WorkspacePullRequest> = {}) => ({
  assignedToMe: true, sourceHead: 'h2', reviewedHead: null, reviewedAt: null, ...extra,
}) as Parameters<typeof deriveReview>[0];
const signals = (extra: object = {}) => ({ myActivityAt: '2026-09-05T10:00:00Z', myDecision: null, observedHead: 'h2', commitsChanged: false, discussion: [], ...extra }) as never;
const item = (kind: 'reply' | 'comment', at: string, author = 'Example Reviewer') => ({ id: `${kind}${at}`, kind, author, at });

describe('deriveReview', () => {
  it('treats assignments without activity or acknowledgement as pending', () => {
    expect(deriveReview(row())).toEqual({ status: 'unreviewed', pending: true, recheck: [] });
    expect(deriveReview(row({ assignedToMe: false }))).toMatchObject({ pending: false });
  });
  it('never flags a recheck without a baseline, even with discussion', () => {
    expect(deriveReview(row({ signals: signals({ myActivityAt: null, discussion: [item('comment', '2026-09-06T00:00:00Z')] }) })).recheck).toEqual([]);
  });
  it('compares timestamps numerically across formats', () => {
    const d = deriveReview(row({ signals: signals({ discussion: [item('comment', '2026-09-05T10:00:00.500000+00:00'), item('comment', '2026-09-05T09:59:59+00:00')] }) }));
    expect(d.recheck).toEqual([{ kind: 'comment', author: 'Example Reviewer', at: '2026-09-05T10:00:00.500000+00:00', count: 1 }]);
  });
  it('ignores a legacy acknowledgement\'s older discussion and flags newer', () => {
    const base = { reviewedHead: 'h2', reviewedAt: '2026-09-05T10:00:00Z', signals: signals({ myActivityAt: null, discussion: [item('comment', '2026-09-04T00:00:00Z')] }) };
    expect(deriveReview(row(base)).status).toBe('reviewed');
    expect(deriveReview(row({ ...base, sourceHead: 'h3' })).recheck).toEqual([{ kind: 'commits' }]);
  });
  it('lets a null discussion marker mean "nothing seen", unlike a legacy acknowledgement', () => {
    const d = deriveReview(row({ reviewedHead: 'h2', reviewedAt: '2026-09-09T00:00:00Z', reviewedDiscussionThrough: null,
      signals: signals({ myActivityAt: null, discussion: [item('reply', '2026-09-06T00:00:00Z')] }) }));
    expect(d.recheck.map(r => r.kind)).toEqual(['reply']);
  });
  it('uses the same derivation for status and explanations', () => {
    const d = deriveReview(row({ signals: signals({ commitsChanged: true, discussion: [item('reply', '2026-09-06T00:00:00Z')] }) }));
    expect(d.status).toBe('updated');
    expect(d.recheck.map(describeRecheck)).toEqual([
      'Since your review: PR commits changed.', 'Since your review: Reply in a thread you joined.']);
    expect(describeRecheck({ kind: 'comment', author: 'Example Reviewer', at: '', count: 1 })).toBe('Since your review: New comment by Example Reviewer.');
  });
});

describe('discussionFrom', () => {
  const c = (id: number, mine: boolean, parentId: number | null, extra: Partial<BbComment> = {}): BbComment => ({
    id, parentId, author: { name: mine ? 'Example Me' : 'Example Reviewer', initials: 'E', isMe: mine }, createdOn: `2026-09-0${id}T00:00:00Z`,
    body: '', resolved: false, deleted: false, inline: null, ...extra });
  it('walks nested replies to the thread root and skips deleted comments', () => {
    const { items, mineAt } = discussionFrom([c(1, true, null), c(2, false, 1), c(3, false, 2), c(4, false, null), c(5, false, 4), c(6, false, 1, { deleted: true })]);
    expect(items.map(i => [i.id, i.kind])).toEqual([['comment:2', 'reply'], ['comment:3', 'reply'], ['comment:4', 'comment'], ['comment:5', 'comment']]);
    expect(mineAt).toBe('2026-09-01T00:00:00Z');
  });
});

describe('BitbucketClient list requests', () => {
  it('keeps literal plus signs and the next-page link', async () => {
    const urls: string[] = [];
    const f = (async (input: string) => {
      urls.push(input);
      if (input.endsWith('/user')) return Response.json({ uuid: '{ME}' });
      return input.includes('page=2') ? Response.json({ values: [{ id: 2, reviewers: [], participants: [] }] })
        : Response.json({ values: [{ id: 1, reviewers: [{ uuid: '{me}' }], participants: [] }], next: 'https://api.example/2.0/repositories/w/r/pullrequests?state=OPEN&page=2&fields=+values.reviewers' });
    }) as unknown as typeof fetch;
    const result = await new BitbucketClient({ base: 'https://api.example/2.0', email: 'e', token: 't', fetch: f }).listOpenPrs('w', 'r');
    expect(result.map(r => [r.pr.id, r.assignedToMe])).toEqual([[1, true], [2, false]]);
    const lists = urls.filter(u => u.includes('pullrequests'));
    expect(lists).toHaveLength(2);
    for (const url of lists) expect(url).toContain('fields=%2Bvalues.reviewers%2C%2Bvalues.participants');
  });
});

describe('mapLimit', () => {
  it('never exceeds the limit and preserves order', async () => {
    let live = 0, peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async n => { peak = Math.max(peak, ++live); await new Promise(r => setTimeout(r, 5)); live--; return n * 2; });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBe(3);
  });
});
