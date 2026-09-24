import type { AiFinding, AiMessage } from '@criever/shared';
import type { Harness, HarnessKind } from './config';
import type { Git } from './git';

const OUTPUT_LIMIT = 1_000_000;
const INPUT_LIMIT = 2_000_000;
const TIMEOUT_MS = 120_000;
export interface AiFindingCandidate { readonly path: string; readonly line: number; readonly side: 'old' | 'new'; readonly body: string; readonly severity: 'info' | 'warning' | 'error' }
export interface AiReviewResult { readonly findings: readonly AiFindingCandidate[]; readonly lookouts: readonly { readonly body: string; readonly path: string; readonly line: number; readonly side: 'old' | 'new' }[] }

export interface AiRunner {
  list(): readonly Pick<Harness, 'id' | 'name' | 'kind'>[];
  run(id: string, prompt: string): Promise<string>;
}

export class AiAdapter implements AiRunner {
  constructor(private readonly harnesses: readonly Harness[], private readonly git: Git) {}
  list(): readonly Pick<Harness, 'id' | 'name' | 'kind'>[] { return this.harnesses.map(({ id, name, kind }) => ({ id, name, kind })); }

  async run(id: string, prompt: string): Promise<string> {
    const harness = this.harnesses.find(item => item.id === id);
    if (!harness) throw new Error(`Unknown AI harness: ${id}`);
    if (Buffer.byteLength(prompt, 'utf8') > INPUT_LIMIT) throw new Error('AI input exceeded limit');
    const proc = Bun.spawn([harness.executable ?? defaultExecutable(harness.kind), ...commandArgs(harness.kind)], {
      cwd: this.git.root, stdout: 'pipe', stderr: 'pipe', stdin: new Blob([prompt]), env: process.env,
    });
    let timedOut = false;
    let exceededLimit = false;
    const timer = setTimeout(() => { timedOut = true; proc.kill(); }, TIMEOUT_MS);
    try {
      const [stdout, stderr, code] = await Promise.all([
        readCapped(proc.stdout, () => { exceededLimit = true; proc.kill(); }),
        readCapped(proc.stderr, () => { exceededLimit = true; proc.kill(); }),
        proc.exited,
      ]);
      if (timedOut) throw new Error('AI harness timed out');
      if (exceededLimit) throw new Error('AI output exceeded limit');
      if (code !== 0) throw new Error(`AI harness exited with status ${code}: ${stderr.slice(0, 2000)}`);
      return parseHarnessOutput(harness.kind, stdout);
    } finally { clearTimeout(timer); }
  }
}

async function readCapped(stream: ReadableStream<Uint8Array>, overLimit: () => void): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > OUTPUT_LIMIT) { overLimit(); await reader.cancel(); break; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function defaultExecutable(kind: HarnessKind): string {
  switch (kind) {
    case 'claude': return 'claude';
    case 'codex': return 'codex';
    case 'opencode': return 'opencode';
    default: return assertNever(kind);
  }
}

function commandArgs(kind: HarnessKind): string[] {
  switch (kind) {
    case 'claude': return ['-p', '--output-format', 'text', '--permission-mode', 'plan'];
    case 'codex': return ['exec', '--sandbox', 'read-only', '--json', '-'];
    case 'opencode': return ['run', '--format', 'json'];
    default: return assertNever(kind);
  }
}

export function parseHarnessOutput(kind: HarnessKind, raw: string): string {
  if (kind === 'claude') return raw.trim();
  const events = raw.split('\n').filter(Boolean).map((line: string): unknown => JSON.parse(line));
  const text: string[] = [];
  for (const event of events) {
    if (typeof event !== 'object' || event === null) continue;
    const record = event as Record<string, unknown>;
    if (kind === 'codex' && record.type === 'item.completed' && typeof record.item === 'object' && record.item !== null && 'type' in record.item && record.item.type === 'agent_message' && 'text' in record.item && typeof record.item.text === 'string') text.push(record.item.text);
    if (kind === 'opencode' && record.type === 'text' && typeof record.part === 'object' && record.part !== null && 'text' in record.part && typeof record.part.text === 'string') text.push(record.part.text);
  }
  return text.join('\n').trim();
}

export function parseReviewResult(raw: string): AiReviewResult {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== 'object' || value === null || !('findings' in value) || !Array.isArray(value.findings) || !('lookouts' in value) || !Array.isArray(value.lookouts)) throw new Error('AI review must contain findings and lookouts arrays');
  const findings = parseFindings(JSON.stringify(value.findings));
  const lookouts = value.lookouts.map((item: unknown): AiReviewResult['lookouts'][number] => {
    if (typeof item !== 'object' || item === null || !('body' in item) || typeof item.body !== 'string' || !item.body.trim()) throw new Error('Invalid AI lookout');
    if (!('path' in item) || typeof item.path !== 'string' || !('line' in item) || typeof item.line !== 'number' || !Number.isInteger(item.line) || item.line < 1 || !('side' in item) || (item.side !== 'old' && item.side !== 'new')) throw new Error('AI lookout requires a changed-line anchor');
    return { body: item.body.trim(), path: item.path, line: item.line, side: item.side };
  });
  return { findings, lookouts };
}

export function parseFindings(raw: string): readonly AiFindingCandidate[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('AI response must be a JSON array');
  return parsed.map((item: unknown) => {
    if (typeof item !== 'object' || item === null) throw new Error('Invalid AI finding');
    const finding = item as Record<string, unknown>;
    if (typeof finding.path !== 'string' || typeof finding.line !== 'number' || !Number.isInteger(finding.line) || finding.line < 1 || typeof finding.body !== 'string' || !['old', 'new'].includes(String(finding.side)) || !['info', 'warning', 'error'].includes(String(finding.severity))) throw new Error('Invalid AI finding');
    if ('lookout' in finding) throw new Error('Lookouts must be returned separately');
    return { path: finding.path, line: finding.line, body: finding.body, side: finding.side as 'old' | 'new', severity: finding.severity as 'info' | 'warning' | 'error' };
  });
}

export function conversationPrompt(messages: readonly AiMessage[], context: string): string {
  return `${context}\n\nConversation:\n${messages.map(message => `${message.role}: ${message.content}`).join('\n')}`;
}

function assertNever(value: never): never { throw new Error(`Unsupported value: ${String(value)}`); }
