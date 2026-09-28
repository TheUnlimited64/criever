import { randomBytes } from 'node:crypto';
import type { AiActiveReview, AiFinding, AiLookout, AiReviewPhase } from '@criever/shared';
import { anchorPath } from './ai-review-anchors';
import { isRecord, MAX_REVIEW_EVENTS, MAX_REVIEW_TOTAL_BYTES, parseReviewEvent, readJson, response, ReviewProtocolError, type AiReviewEvent } from './ai-review-protocol';
import { AiReviewTransport } from './ai-review-transport';
import { pendingObservation, reviewSummary, snapshot, type ReviewRun, type StartedReview, type StartReviewInput } from './ai-review-types';
import type { StateStore } from './state';

const SHUTDOWN_TIMEOUT_MS = 2_000;

export class AiReviewChannel {
  private readonly transport: AiReviewTransport;
  private readonly runs = new Map<string, ReviewRun>();
  private readonly completions = new Map<string, Promise<void>>();
  private closing: Promise<void> | null = null;

  constructor(private readonly store: StateStore, readonly command = 'criever --ai') {
    this.transport = new AiReviewTransport(request => this.handle(request));
  }

  get socketPath(): string {
    return this.transport.socketPath;
  }

  get activeReviews(): readonly AiActiveReview[] {
    return [...this.runs.values()].map(snapshot);
  }

  async waitForCompletion(id: string): Promise<void> {
    await this.completions.get(id);
  }

  async start(): Promise<void> {
    await this.transport.start();
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    const closing = this.shutdown();
    this.closing = closing;
    try { await closing; }
    finally { if (this.closing === closing) this.closing = null; }
  }

  async startReview(input: StartReviewInput): Promise<StartedReview> {
    if (this.closing) throw new Error('AI review channel is shutting down');
    await this.start();
    const id = crypto.randomUUID();
    let resolveDone = () => {};
    const done = new Promise<void>(resolve => { resolveDone = resolve; });
    const token = randomBytes(32).toString('hex');
    const abortController = new AbortController();
    const run: ReviewRun = {
      id, token, harnessId: input.harnessId, head: input.head, startedAt: new Date().toISOString(), anchor: input,
      observations: [], findings: [], lookouts: [], abortController, queue: Promise.resolve(), launchDone: Promise.resolve(),
      eventCount: 0, eventBytes: 0, status: 'starting', completeRequested: false, closed: false, doneResolved: false, resolveDone,
    };
    this.runs.set(id, run);
    this.completions.set(id, done);
    const env = {
      ...await this.transport.endpoint(input.transport ?? 'unix'),
      CRIEVER_AI_TOKEN: token,
      CRIEVER_AI_REVIEW_ID: id,
      CRIEVER_AI_COMMAND: this.command,
    };
    run.launchDone = this.launch(run, input, env);
    return { id, done };
  }

  private async handle(request: Request): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/review') return response({ error: 'not found' }, 404);
    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) return response({ error: 'AI review capability required' }, 401);
    const token = authorization.slice('Bearer '.length);
    let raw: unknown;
    try { raw = await readJson(request); }
    catch (error) {
      if (error instanceof ReviewProtocolError) return response({ error: error.message }, error.status);
      throw error;
    }
    if (!isRecord(raw) || typeof raw.reviewId !== 'string') return response({ error: 'reviewId required' }, 400);
    const run = this.runs.get(raw.reviewId);
    if (!run || token !== run.token) return response({ error: 'invalid AI review capability' }, 403);
    let event: AiReviewEvent;
    try { event = parseReviewEvent(raw); }
    catch (error) {
      if (error instanceof ReviewProtocolError) return response({ error: error.message }, error.status);
      throw error;
    }
    return this.enqueue(run, () => this.apply(run, event)).catch(error => {
      if (error instanceof ReviewProtocolError) return response({ error: error.message }, error.status);
      throw error;
    });
  }

  private enqueue(run: ReviewRun, action: () => Promise<Response>): Promise<Response> {
    const next = run.queue.then(action);
    run.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private async apply(run: ReviewRun, event: AiReviewEvent): Promise<Response> {
    if (run.closed || run.status === 'complete' || run.status === 'failed' || run.status === 'incomplete') return response({ error: 'review is already finished' }, 409);
    if (run.completeRequested) return response({ error: 'review is already completing' }, 409);
    run.eventCount += 1;
    run.eventBytes += Buffer.byteLength(JSON.stringify(event));
    if (run.eventCount > MAX_REVIEW_EVENTS || run.eventBytes > MAX_REVIEW_TOTAL_BYTES) {
      const error = 'review event quota exceeded';
      this.fail(run, 'failed', error);
      run.abortController.abort(new Error(error));
      throw new ReviewProtocolError(413, error);
    }
    switch (event.type) {
      case 'status':
        run.status = event.phase;
        if (event.message) run.message = event.message;
        return response({ ok: true, status: run.status });
      case 'observation':
        if (run.observations.some(item => item.id === event.id)) throw new ReviewProtocolError(409, 'observation id already exists');
        run.observations.push({ id: event.id, evidence: event.evidence, disposition: 'pending' });
        return response({ ok: true, status: run.status });
      case 'finding':
        return response({ ok: true, item: await this.addFinding(run, event) });
      case 'lookout':
        return response({ ok: true, item: await this.addLookout(run, event) });
      case 'dismissal':
        return response({ ok: true, status: this.dismiss(run, event.observationId, event.reason) });
      case 'incomplete':
        this.fail(run, 'incomplete', event.reason);
        return response({ ok: true, status: 'incomplete' });
      case 'complete':
        return this.complete(run);
      default:
        return assertNever(event);
    }
  }

  private async addFinding(run: ReviewRun, event: Extract<AiReviewEvent, { readonly type: 'finding' }>): Promise<AiFinding> {
    const observation = pendingObservation(run, event.observationId);
    const path = await anchorPath(run.anchor, event.path, event.line, event.side);
    const finding: AiFinding = { id: crypto.randomUUID(), path, line: event.line, side: event.side, body: event.body, severity: event.severity, anchorCommit: run.head, reviewId: run.id };
    run.findings.push(finding);
    observation.disposition = 'finding';
    return finding;
  }

  private async addLookout(run: ReviewRun, event: Extract<AiReviewEvent, { readonly type: 'lookout' }>): Promise<AiLookout> {
    const observation = pendingObservation(run, event.observationId);
    const path = await anchorPath(run.anchor, event.path, event.line, event.side);
    const lookout: AiLookout = { id: crypto.randomUUID(), body: event.body, path, line: event.line, side: event.side, anchorCommit: run.head, reviewId: run.id };
    run.lookouts.push(lookout);
    observation.disposition = 'lookout';
    return lookout;
  }

  private dismiss(run: ReviewRun, observationId: string, reason: string): AiReviewPhase {
    const observation = pendingObservation(run, observationId);
    observation.disposition = 'dismissed';
    observation.reason = reason;
    return run.status;
  }

  private async complete(run: ReviewRun): Promise<Response> {
    if (run.observations.some(item => item.disposition === 'pending')) throw new ReviewProtocolError(409, 'every observation must be classified before completion');
    run.completeRequested = true;
    run.status = 'completing';
    return response({ ok: true, status: 'completing' });
  }

  private async launch(run: ReviewRun, input: StartReviewInput, env: Readonly<Record<string, string>>): Promise<void> {
    let launchError: string | undefined;
    try {
      await input.launch(env, run.abortController.signal);
    } catch (cause) {
      launchError = cause instanceof Error ? cause.message : 'AI harness failed';
    }
    try {
      await this.harnessExited(run, launchError === undefined, launchError);
    } catch (failure) {
      if (!run.closed && this.runs.has(run.id)) this.fail(run, 'failed', failure instanceof Error ? failure.message : String(failure));
    }
  }

  private async harnessExited(run: ReviewRun, successful: boolean, error = 'AI harness failed'): Promise<void> {
    await this.enqueue(run, async () => {
      if (run.closed || !this.runs.has(run.id)) return response({ ok: true });
      if (!successful) {
        this.fail(run, 'failed', error);
        return response({ ok: true });
      }
      if (!run.completeRequested) {
        this.fail(run, 'incomplete', 'AI harness exited without an explicit complete event');
        return response({ ok: true });
      }
      await this.persist(run);
      return response({ ok: true });
    });
  }

  private async persist(run: ReviewRun): Promise<void> {
    const summary = reviewSummary(run);
    try {
      if (run.closed || this.closing) {
        this.fail(run, 'failed', 'Criever shut down before the review completed');
        return;
      }
      await this.store.completeAiReview(summary, run.findings, run.lookouts);
    } catch (error) {
      this.fail(run, 'failed', `AI review could not be persisted: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    run.status = 'complete';
    run.completedAt = summary.completedAt;
    this.runs.delete(run.id);
    this.resolveDone(run);
  }

  private fail(run: ReviewRun, status: 'failed' | 'incomplete', error: string): void {
    if (run.status === 'complete' || run.status === 'failed' || run.status === 'incomplete') return;
    run.status = status;
    run.error = error;
    this.resolveDone(run);
  }

  private resolveDone(run: ReviewRun): void {
    if (run.doneResolved) return;
    run.doneResolved = true;
    run.resolveDone();
  }

  private async shutdown(): Promise<void> {
    const runs = [...this.runs.values()];
    for (const run of runs) {
      run.closed = true;
      run.status = 'failed';
      run.error = 'Criever shut down before the review completed';
      run.abortController.abort(new Error(run.error));
      this.resolveDone(run);
    }
    this.transport.stopAccepting();
    await Promise.race([
      Promise.allSettled(runs.map(run => run.launchDone)),
      new Promise<void>(resolve => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
    ]);
    await this.transport.close();
    this.runs.clear();
  }
}

function assertNever(value: never): never { throw new Error(`Unsupported AI review event: ${String(value)}`); }
