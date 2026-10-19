import type { WorkspacePullRequest } from './workspace';

export type ReviewDecision = 'approved' | 'changes_requested';

/** Something another person did on a pull request, recorded compactly at sync time. */
export interface DiscussionItem {
  readonly id: string;
  /** `reply` = a reply in a thread the current user joined; `comment` = any other comment. */
  readonly kind: 'reply' | 'comment' | 'feedback';
  readonly author: string;
  readonly at: string;
  readonly decision?: ReviewDecision;
}

/** Provider activity observed for the current user, persisted with the workspace row. */
export interface ReviewSignals {
  /** Latest published comment or explicit decision by the current user. */
  readonly myActivityAt: string | null;
  readonly myDecision: ReviewDecision | null;
  /** Full commit ID that the latest provider review activity covered, once known. */
  readonly observedHead: string | null;
  /** Commits changed since that activity (the sync-time timestamp comparison when no head is known). */
  readonly commitsChanged: boolean;
  readonly discussion: readonly DiscussionItem[];
}

export type RecheckReason =
  | { readonly kind: 'commits' }
  | { readonly kind: 'reply' | 'comment'; readonly author: string; readonly at: string; readonly count: number }
  | { readonly kind: 'feedback'; readonly author: string; readonly at: string; readonly count: number; readonly decision: ReviewDecision };

export interface ReviewDerivation {
  readonly status: WorkspacePullRequest['status'];
  readonly pending: boolean;
  readonly recheck: readonly RecheckReason[];
}

type ReviewInput = Pick<WorkspacePullRequest, 'assignedToMe' | 'sourceHead' | 'reviewedHead' | 'reviewedAt'
  | 'reviewedActivityAt' | 'reviewedDiscussionThrough' | 'signals'>;

/** Milliseconds for an ISO timestamp; unparseable values never count as newer than anything. */
export const timeOf = (iso: string | null | undefined): number => {
  const value = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(value) ? -Infinity : value;
};

/**
 * The single source of truth for filters, status chips and recheck explanations.
 * A local acknowledgement is the baseline unless the user has since been active on the provider.
 */
export function deriveReview(pr: ReviewInput): ReviewDerivation {
  const signals = pr.signals;
  const activityAt = signals?.myActivityAt ?? null;
  const providerReviewed = activityAt !== null || !!signals?.myDecision;
  const acknowledged = pr.reviewedHead != null
    && !(activityAt !== null && timeOf(activityAt) > timeOf(pr.reviewedActivityAt ?? pr.reviewedAt));
  const reviewed = acknowledged || providerReviewed;
  const reasons: RecheckReason[] = [];
  if (reviewed) {
    const changed = acknowledged ? pr.reviewedHead !== pr.sourceHead : signals?.commitsChanged === true;
    if (changed) reasons.push({ kind: 'commits' });
    const through = Math.max(timeOf(activityAt),
      acknowledged ? timeOf(pr.reviewedDiscussionThrough === undefined ? pr.reviewedAt : pr.reviewedDiscussionThrough) : -Infinity);
    for (const kind of ['reply', 'comment', 'feedback'] as const) {
      const items = (signals?.discussion ?? []).filter(item => item.kind === kind && timeOf(item.at) > through);
      const latest = items.reduce<DiscussionItem | null>((a, b) => !a || timeOf(b.at) >= timeOf(a.at) ? b : a, null);
      if (!latest) continue;
      reasons.push(kind === 'feedback' && latest.decision
        ? { kind, author: latest.author, at: latest.at, count: items.length, decision: latest.decision }
        : { kind: kind === 'feedback' ? 'comment' : kind, author: latest.author, at: latest.at, count: items.length });
    }
  }
  return {
    status: reasons.length ? 'updated' : reviewed ? 'reviewed' : 'unreviewed',
    pending: pr.assignedToMe && !reviewed, recheck: reasons,
  };
}

/** Newest discussion timestamp, recorded when the user acknowledges so later items stand out. */
export const discussionThrough = (signals: ReviewSignals | undefined): string | null =>
  (signals?.discussion ?? []).reduce<string | null>((a, b) => timeOf(b.at) > timeOf(a) ? b.at : a, null);

export function describeRecheck(reason: RecheckReason): string {
  switch (reason.kind) {
    case 'commits': return 'Since your review: PR commits changed.';
    case 'reply': return 'Since your review: Reply in a thread you joined.';
    case 'comment': return `Since your review: New comment by ${reason.author}.`;
    case 'feedback': return `Since your review: ${reason.decision === 'approved' ? 'Approved' : 'Changes requested'} by ${reason.author}.`;
  }
}
