import type { AiActiveReview, AiFinding, AiLookout, AiReviewObservation, AiReviewPhase, AiReviewRun, FileDiff } from '@criever/shared';
import { ReviewProtocolError } from './ai-review-protocol';
import type { Git } from './git';

export interface AnchorContext {
  readonly git: Git;
  readonly base: string;
  readonly head: string;
  readonly changedFiles: readonly FileDiff[];
  readonly anchors: ReadonlySet<string>;
  readonly renames: ReadonlyMap<string, string>;
}

export interface StartReviewInput extends AnchorContext {
  readonly harnessId: string;
  readonly transport?: 'unix' | 'tcp';
  readonly launch: (env: Readonly<Record<string, string>>, signal?: AbortSignal) => Promise<unknown>;
}

export interface StartedReview { readonly id: string; readonly done: Promise<void> }

export interface MutableObservation {
  readonly id: string;
  readonly evidence: string;
  disposition: AiReviewObservation['disposition'];
  reason?: string;
}

export interface ReviewRun {
  readonly id: string;
  readonly token: string;
  readonly harnessId: string;
  readonly head: string;
  readonly startedAt: string;
  readonly anchor: AnchorContext;
  readonly observations: MutableObservation[];
  readonly findings: AiFinding[];
  readonly lookouts: AiLookout[];
  readonly abortController: AbortController;
  queue: Promise<void>;
  launchDone: Promise<void>;
  eventCount: number;
  eventBytes: number;
  status: AiReviewPhase;
  message?: string;
  error?: string;
  completedAt?: string;
  completeRequested: boolean;
  closed: boolean;
  doneResolved: boolean;
  resolveDone: () => void;
}

export function pendingObservation(run: ReviewRun, id: string): MutableObservation {
  const observation = run.observations.find(item => item.id === id);
  if (!observation) throw new ReviewProtocolError(409, `unknown observation: ${id}`);
  if (observation.disposition !== 'pending') throw new ReviewProtocolError(409, `observation already classified: ${id}`);
  return observation;
}

export function reviewSummary(run: ReviewRun): AiReviewRun {
  const first = run.findings[0] ?? run.lookouts.find(item => item.path && item.side && item.line);
  return {
    id: run.id, harnessId: run.harnessId, head: run.head, completedAt: new Date().toISOString(), findings: run.findings.length, lookouts: run.lookouts.length,
    first: first?.path && first.side && first.line ? { path: first.path, side: first.side, line: first.line } : null,
  };
}

export function snapshot(run: ReviewRun): AiActiveReview {
  return {
    id: run.id, harnessId: run.harnessId, head: run.head, startedAt: run.startedAt, status: run.status,
    observations: run.observations.map(item => ({ ...item })), findings: [...run.findings], lookouts: [...run.lookouts],
    ...(run.message ? { message: run.message } : {}), ...(run.error ? { error: run.error } : {}), ...(run.completedAt ? { completedAt: run.completedAt } : {}),
  };
}
