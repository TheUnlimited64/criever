import { parseReviewResult, type AiRunner } from '../src/ai';

type ReviewEnv = Readonly<Record<string, string | undefined>>;
type ReviewRecord = Record<string, unknown>;

const wrappedRunners = new WeakSet<AiRunner>();

export function withReviewEvents(runner: AiRunner): AiRunner {
  if (wrappedRunners.has(runner)) return runner;
  const wrapped: AiRunner = {
    ...runner,
    run: async (id, prompt, mode, options) => {
      const output = await runner.run(id, prompt, mode, options);
      if (mode === 'patch' && options?.env) await postReviewOutput(output, options.env);
      return output;
    },
  };
  wrappedRunners.add(wrapped);
  return wrapped;
}

async function postReviewOutput(raw: string, env: ReviewEnv): Promise<void> {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) return;
  if (value.status === 'incomplete' && Array.isArray(value.limitations) && typeof value.limitations[0] === 'string') {
    await post(env, { type: 'incomplete', reason: value.limitations[0] });
    return;
  }
  if (value.status !== 'complete' || !Array.isArray(value.limitations) || value.limitations.length > 0) return;
  parseReviewResult(raw);
  const observations = Array.isArray(value.observations) ? value.observations.filter(isRecord) : [];
  for (const observation of observations) await post(env, { type: 'observation', id: stringValue(observation.id), evidence: stringValue(observation.evidence) });
  for (const item of arrayRecords(value.findings)) await post(env, { type: 'finding', observationId: stringValue(item.observationId), path: stringValue(item.path), line: numberValue(item.line), side: stringValue(item.side), severity: stringValue(item.severity), body: stringValue(item.body) });
  for (const item of arrayRecords(value.lookouts)) await post(env, { type: 'lookout', observationId: stringValue(item.observationId), path: stringValue(item.path), line: numberValue(item.line), side: stringValue(item.side), body: stringValue(item.body) });
  for (const observation of observations) if (observation.disposition === 'dismissed') await post(env, { type: 'dismissal', observationId: stringValue(observation.id), reason: stringValue(observation.reason) });
  await post(env, { type: 'complete' });
}

async function post(env: ReviewEnv, event: Readonly<Record<string, unknown>>): Promise<void> {
  const socket = env.CRIEVER_AI_SOCKET;
  const url = env.CRIEVER_AI_URL;
  const token = env.CRIEVER_AI_TOKEN;
  const reviewId = env.CRIEVER_AI_REVIEW_ID;
  if ((!socket && !url) || !token || !reviewId) throw new Error('review test capability missing');
  const response = await fetch(url ?? 'http://criever-ai/review', { ...(socket && !url ? { unix: socket } : {}), method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ reviewId, ...event }) });
  if (!response.ok) throw new Error(await response.text());
}

function isRecord(value: unknown): value is ReviewRecord { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function arrayRecords(value: unknown): ReviewRecord[] { return Array.isArray(value) ? value.filter(isRecord) : []; }
function stringValue(value: unknown): string { if (typeof value !== 'string') throw new Error('invalid review fixture string'); return value; }
function numberValue(value: unknown): number { if (typeof value !== 'number') throw new Error('invalid review fixture number'); return value; }
