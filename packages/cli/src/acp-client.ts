import * as acp from '@agentclientprotocol/sdk';
import type { AcpHarness } from './config';

const CHAT_TIMEOUT_MS = 120_000;
const REVIEW_TIMEOUT_MS = 1_800_000;
const MAX_OUTPUT_BYTES = 1_000_000;
const MAX_STDERR_BYTES = 64_000;

type Environment = Readonly<Record<string, string | undefined>>;

export interface AcpRunOptions {
  readonly env?: Environment;
  readonly signal?: AbortSignal;
}

export async function runAcpHarness(
  harness: AcpHarness,
  prompt: string,
  mode: 'chat' | 'patch',
  cwd: string,
  options?: AcpRunOptions,
): Promise<string> {
  if (!harness.executable) throw new Error(`ACP harness ${harness.id} has no executable configured`);
  options?.signal?.throwIfAborted();

  const inherited = stringEnvironment(process.env);
  for (const key of Object.keys(inherited)) if (key.startsWith('CRIEVER_AI_')) delete inherited[key];
  const child = Bun.spawn([harness.executable, ...(harness.args ?? [])], {
    cwd,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...inherited, ...stringEnvironment(options?.env ?? {}) },
  });
  if (!child.stdout) throw new Error('ACP harness stdout is unavailable');

  let exitCode: number | undefined;
  const exited = child.exited.then(code => {
    exitCode = code;
    return code;
  });
  const stderr = readStream(child.stderr, MAX_STDERR_BYTES);
  const output: string[] = [];
  let outputBytes = 0;
  let timedOut = false;
  let completed = false;
  let failure: unknown = null;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, mode === 'patch' ? REVIEW_TIMEOUT_MS : CHAT_TIMEOUT_MS);
  const abort = () => child.kill();
  options?.signal?.addEventListener('abort', abort, { once: true });

  try {
    const stream = acp.ndJsonStream(createInput(child.stdin), child.stdout);
    await acp.client({ name: 'criever' })
      .onRequest(acp.methods.client.session.requestPermission, ctx => reviewPermission(ctx.params, mode))
      .connectWith(stream, async ctx => {
        const initialized = await ctx.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
        });
        if (initialized.protocolVersion !== acp.PROTOCOL_VERSION) {
          throw new Error(`ACP protocol version ${initialized.protocolVersion} is unsupported`);
        }
        return ctx.buildSession(cwd).withSession(async session => {
          const promptResult = session.prompt(prompt);
          for (;;) {
            const message = await session.nextUpdate();
            if (message.kind === 'stop') {
              const result = await promptResult;
              if (result.stopReason !== 'end_turn') throw new Error(`ACP prompt stopped with ${result.stopReason}`);
              completed = true;
              return result;
            }
            const update = message.notification.update;
            if (update.sessionUpdate !== 'agent_message_chunk' || update.content.type !== 'text') continue;
            outputBytes += Buffer.byteLength(update.content.text, 'utf8');
            if (outputBytes > MAX_OUTPUT_BYTES) throw new Error('ACP output exceeded limit');
            output.push(update.content.text);
          }
        });
      });
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(timeout);
    options?.signal?.removeEventListener('abort', abort);
    if (exitCode === undefined) child.kill();
    await exited;
  }

  if (failure !== null) {
    if (options?.signal?.aborted) throw failure;
    const details = await stderr;
    const message = timedOut ? 'ACP harness timed out' : failure instanceof Error ? failure.message : String(failure);
    throw new Error(details ? `${message}: ${details}` : message, { cause: failure });
  }
  if (!completed) throw new Error('ACP harness ended before completing the prompt');
  return mode === 'patch' ? '' : output.join('').trim();
}

async function reviewPermission(params: acp.RequestPermissionRequest, mode: 'chat' | 'patch'): Promise<acp.RequestPermissionResponse> {
  // Review commands include dependency setup and validation. File-edit requests
  // remain denied; the review prompt constrains commands to preserving tracked files.
  if (mode === 'patch' && ['read', 'search', 'execute'].includes(params.toolCall.kind ?? '')) {
    const allow = params.options.find(item => item.kind === 'allow_once');
    if (allow) return { outcome: { outcome: 'selected', optionId: allow.optionId } };
  }
  const option = params.options.find(item => item.kind === 'reject_once' || item.kind === 'reject_always');
  return option
    ? { outcome: { outcome: 'selected', optionId: option.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}

function createInput(stdin: Bun.Subprocess['stdin']): WritableStream<Uint8Array> {
  if (!stdin || typeof stdin === 'number') throw new Error('ACP harness stdin is unavailable');
  return new WritableStream({
    async write(chunk) {
      await stdin.write(chunk);
      await stdin.flush();
    },
    close() { stdin.end(); },
    abort() { stdin.end(); },
  });
}

async function readStream(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (size >= limit) continue;
      const remaining = limit - size;
      const chunk = next.value.byteLength <= remaining ? next.value : next.value.slice(0, remaining);
      chunks.push(chunk);
      size += chunk.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

function stringEnvironment(env: Environment): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined) result[key] = value;
  return result;
}
