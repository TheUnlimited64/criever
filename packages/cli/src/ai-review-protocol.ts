import type { Side } from '@criever/shared';

const REVIEW_PHASES = ['starting', 'observing', 'classifying', 'completing'] as const;
const SIDES = ['old', 'new'] as const;
const SEVERITIES = ['info', 'warning', 'error'] as const;
export const MAX_REVIEW_EVENT_BYTES = 256 * 1024;
export const MAX_REVIEW_EVENTS = 2_048;
export const MAX_REVIEW_TOTAL_BYTES = 4_000_000;
const MAX_REVIEW_TEXT_LENGTH = 100_000;
type ReviewPhase = (typeof REVIEW_PHASES)[number];
type Severity = (typeof SEVERITIES)[number];

export type AiReviewEvent =
  | { readonly type: 'status'; readonly phase: ReviewPhase; readonly message?: string }
  | { readonly type: 'observation'; readonly id: string; readonly evidence: string }
  | { readonly type: 'finding'; readonly observationId: string; readonly path: string; readonly line: number; readonly side: Side; readonly severity: Severity; readonly body: string }
  | { readonly type: 'lookout'; readonly observationId: string; readonly path: string; readonly line: number; readonly side: Side; readonly body: string }
  | { readonly type: 'dismissal'; readonly observationId: string; readonly reason: string }
  | { readonly type: 'incomplete'; readonly reason: string }
  | { readonly type: 'complete' };

export class ReviewProtocolError extends Error {
  readonly name = 'ReviewProtocolError';
  constructor(readonly status: 400 | 401 | 403 | 409 | 413 | 422, message: string) { super(message); }
}

export function parseReviewEvent(value: unknown): AiReviewEvent {
  if (!isRecord(value) || typeof value.type !== 'string') throw new ReviewProtocolError(400, 'event type required');
  switch (value.type) {
    case 'status':
      return { type: 'status', phase: phase(value.phase), ...(optionalText(value.message) ? { message: optionalText(value.message) } : {}) };
    case 'observation':
      return { type: 'observation', id: text(value.id, 'observation id'), evidence: text(value.evidence, 'observation evidence') };
    case 'finding':
      return {
        type: 'finding',
        observationId: text(value.observationId, 'observation id'),
        path: text(value.path, 'finding path'),
        line: positiveLine(value.line),
        side: side(value.side),
        severity: severity(value.severity),
        body: text(value.body, 'finding body'),
      };
    case 'lookout':
      return {
        type: 'lookout',
        observationId: text(value.observationId, 'observation id'),
        path: text(value.path, 'lookout path'),
        line: positiveLine(value.line),
        side: side(value.side),
        body: text(value.body, 'lookout body'),
      };
    case 'dismissal':
      return { type: 'dismissal', observationId: text(value.observationId, 'observation id'), reason: text(value.reason, 'dismissal reason') };
    case 'incomplete':
      return { type: 'incomplete', reason: text(value.reason, 'incomplete reason') };
    case 'complete':
      return { type: 'complete' };
    default:
      throw new ReviewProtocolError(400, `unsupported event type: ${value.type}`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_REVIEW_TEXT_LENGTH) throw new ReviewProtocolError(400, `${label} must be 1-${MAX_REVIEW_TEXT_LENGTH} characters`);
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return text(value, 'status message');
}

function phase(value: unknown): ReviewPhase {
  if (typeof value === 'string' && (REVIEW_PHASES as readonly string[]).includes(value)) return value as ReviewPhase;
  throw new ReviewProtocolError(400, 'status must be starting, observing, classifying, or completing');
}

function side(value: unknown): Side {
  if (typeof value === 'string' && (SIDES as readonly string[]).includes(value)) return value as Side;
  throw new ReviewProtocolError(400, 'side must be old or new');
}

function severity(value: unknown): Severity {
  if (typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value)) return value as Severity;
  throw new ReviewProtocolError(400, 'severity must be info, warning, or error');
}

function positiveLine(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new ReviewProtocolError(400, 'line must be a positive integer');
  return value;
}

export function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export async function readJson(request: Request): Promise<unknown> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > MAX_REVIEW_EVENT_BYTES) throw new ReviewProtocolError(413, `review event body exceeds ${MAX_REVIEW_EVENT_BYTES} bytes`);
  }
  if (!request.body) throw new ReviewProtocolError(400, 'JSON body required');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REVIEW_EVENT_BYTES) {
        await reader.cancel().catch(() => {});
        throw new ReviewProtocolError(413, `review event body exceeds ${MAX_REVIEW_EVENT_BYTES} bytes`);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch (error) {
    if (error instanceof SyntaxError) throw new ReviewProtocolError(400, 'JSON body required');
    throw error;
  }
}
