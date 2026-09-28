import { UserError } from './errors';
import type { AiReviewEvent } from './ai-review-protocol';

const SOCKET_ENV = 'CRIEVER_AI_SOCKET';
const TOKEN_ENV = 'CRIEVER_AI_TOKEN';
const REVIEW_ENV = 'CRIEVER_AI_REVIEW_ID';

export async function runAiCli(argv: readonly string[], env: Readonly<Record<string, string | undefined>> = process.env): Promise<number> {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    console.log('Usage: criever --ai status --status starting|observing|classifying|completing [--message TEXT]\n       criever --ai observation --id ID --evidence TEXT\n       criever --ai finding --observation-id ID --path PATH --line N --side old|new --severity info|warning|error --body TEXT\n       criever --ai lookout --observation-id ID --path PATH --line N --side old|new --body TEXT\n       criever --ai dismissal --observation-id ID --reason TEXT\n       criever --ai incomplete --reason TEXT\n       criever --ai complete');
    return 0;
  }
  try {
    const event = parseCommand(argv);
    const url = env.CRIEVER_AI_URL;
    const socket = url ? undefined : requiredEnv(env, SOCKET_ENV);
    const token = requiredEnv(env, TOKEN_ENV);
    const reviewId = requiredEnv(env, REVIEW_ENV);
    const response = await fetch(url ?? 'http://criever-ai/review', {
      ...(socket ? { unix: socket } : {}),
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reviewId, ...event }),
    });
    const body = await response.text();
    if (!response.ok) {
      console.error(body || `AI review post rejected with status ${response.status}`);
      return 1;
    }
    if (body) console.log(body);
    return 0;
  } catch (error) {
    if (error instanceof UserError) { console.error(error.message); return 1; }
    if (error instanceof Error) { console.error(`AI review post failed: ${error.message}`); return 1; }
    throw error;
  }
}

function parseCommand(argv: readonly string[]): AiReviewEvent {
  const command = argv[0];
  const options = parseOptions(argv.slice(1));
  switch (command) {
    case 'status': {
      const phase = required(options, '--status');
      if (!['starting', 'observing', 'classifying', 'completing'].includes(phase)) throw new UserError('--status must be starting, observing, classifying, or completing.');
      const message = options.get('--message');
      return { type: 'status', phase: phase as 'starting' | 'observing' | 'classifying' | 'completing', ...(message ? { message } : {}) };
    }
    case 'observation': return { type: 'observation', id: required(options, '--id'), evidence: required(options, '--evidence') };
    case 'finding': return {
      type: 'finding', observationId: required(options, '--observation-id'), path: required(options, '--path'), line: positiveInteger(required(options, '--line')),
      side: parseChoice(options, '--side', ['old', 'new'] as const), severity: parseChoice(options, '--severity', ['info', 'warning', 'error'] as const), body: required(options, '--body'),
    };
    case 'lookout': return {
      type: 'lookout', observationId: required(options, '--observation-id'), path: required(options, '--path'), line: positiveInteger(required(options, '--line')),
      side: parseChoice(options, '--side', ['old', 'new'] as const), body: required(options, '--body'),
    };
    case 'dismissal': return { type: 'dismissal', observationId: required(options, '--observation-id'), reason: required(options, '--reason') };
    case 'incomplete': return { type: 'incomplete', reason: required(options, '--reason') };
    case 'complete':
      if (options.size > 0) throw new UserError('The complete event takes no flags.');
      return { type: 'complete' };
    default:
      throw new UserError('Usage: criever --ai status|observation|finding|lookout|dismissal|incomplete|complete [flags].');
  }
}

function parseOptions(argv: readonly string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (!flag?.startsWith('--')) throw new UserError(`Unexpected AI review argument: ${flag ?? ''}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new UserError(`Missing value for ${flag}.`);
    options.set(flag, value);
    index++;
  }
  return options;
}

function required(options: ReadonlyMap<string, string>, flag: string): string {
  const value = options.get(flag);
  if (!value?.trim()) throw new UserError(`Missing ${flag} value.`);
  return value;
}

function positiveInteger(value: string): number {
  const line = Number(value);
  if (!Number.isInteger(line) || line < 1) throw new UserError(`--line must be a positive integer, got "${value}".`);
  return line;
}

function parseChoice<const T extends readonly string[]>(options: ReadonlyMap<string, string>, flag: string, choices: T): T[number] {
  const value = required(options, flag);
  if (!choices.includes(value)) throw new UserError(`${flag} must be one of ${choices.join(', ')}.`);
  return value as T[number];
}

function requiredEnv(env: Readonly<Record<string, string | undefined>>, key: string): string {
  const value = env[key];
  if (!value) throw new UserError(`${key} is available only while an AI review is running.`);
  return value;
}
