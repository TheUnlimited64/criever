import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiAdapter } from '../src/ai';
import { AiReviewChannel } from '../src/ai-review-channel';
import { Git } from '../src/git';
import { fixture } from './ai-review-fixture';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('runs an arbitrary ACP harness over stdio and returns message chunks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'criever-acp-'));
  roots.push(root);
  const agent = writeAgent(root);
  const methods = join(root, 'methods.log');
  const args = join(root, 'args.json');
  const adapter = new AiAdapter([{
    id: 'generic',
    name: 'Generic ACP',
    kind: 'acp',
    executable: process.execPath,
    args: [agent, '--profile', 'review'],
  }], new Git(root));

  await expect(adapter.run('generic', 'Explain this change', 'chat', { env: { METHODS_LOG: methods, ARGS_LOG: args } })).resolves.toBe('hello ACP');
  expect(readFileSync(methods, 'utf8').trim().split('\n')).toEqual(['initialize', 'session/new', 'session/prompt']);
  expect(JSON.parse(readFileSync(args, 'utf8'))).toEqual(['--profile', 'review']);
});

it('rejects ACP permission requests instead of granting tool access', async () => {
  const root = mkdtempSync(join(tmpdir(), 'criever-acp-permission-'));
  roots.push(root);
  const agent = writeAgent(root);
  const outcome = join(root, 'permission.json');
  const adapter = new AiAdapter([{
    id: 'generic',
    name: 'Generic ACP',
    kind: 'acp',
    executable: process.execPath,
    args: [agent],
  }], new Git(root));

  await expect(adapter.run('generic', 'Inspect this change', 'chat', { env: { PERMISSION_LOG: outcome } })).resolves.toBe('permission denied');
  expect(JSON.parse(readFileSync(outcome, 'utf8'))).toEqual({ outcome: 'selected', optionId: 'reject' });
});

it.each([
  ['execute', 'allow'],
  ['read', 'allow'],
  ['edit', 'reject'],
  ['delete', 'reject'],
  ['other', 'reject'],
])('handles ACP review %s permission as %s', async (kind, expected) => {
  const root = mkdtempSync(join(tmpdir(), 'criever-acp-setup-'));
  roots.push(root);
  const outcome = join(root, 'permission.json');
  const adapter = new AiAdapter([{
    id: 'generic', name: 'Generic ACP', kind: 'acp',
    executable: process.execPath, args: [writeAgent(root)],
  }], new Git(root));
  await adapter.run('generic', 'Review with necessary dependency setup', 'patch', {
    env: { CRIEVER_AI_URL: 'http://127.0.0.1:43123/review', PERMISSION_LOG: outcome, TOOL_KIND: kind },
  });
  expect(JSON.parse(readFileSync(outcome, 'utf8'))).toEqual({ outcome: 'selected', optionId: expected });
});

it('passes the review capability only to the ACP child and hides final review prose', async () => {
  const root = mkdtempSync(join(tmpdir(), 'criever-acp-review-'));
  roots.push(root);
  const agent = writeAgent(root);
  const envLog = join(root, 'env.json');
  const adapter = new AiAdapter([{
    id: 'generic',
    name: 'Generic ACP',
    kind: 'acp',
    executable: process.execPath,
    args: [agent],
  }], new Git(root));

  await expect(adapter.run('generic', 'Review this change', 'patch', {
    env: {
      CRIEVER_AI_URL: 'http://127.0.0.1:43123/review',
      CRIEVER_AI_TOKEN: 'token',
      CRIEVER_AI_REVIEW_ID: 'review',
      CRIEVER_AI_COMMAND: 'criever --ai',
      ENV_LOG: envLog,
    },
  })).resolves.toBe('');
  expect(JSON.parse(readFileSync(envLog, 'utf8'))).toEqual({
    CRIEVER_AI_URL: 'http://127.0.0.1:43123/review',
    CRIEVER_AI_TOKEN: 'token',
    CRIEVER_AI_REVIEW_ID: 'review',
    CRIEVER_AI_COMMAND: 'criever --ai',
  });
});

it('lets an ACP harness post a complete review over the TCP endpoint', async () => {
  const f = await fixture(roots);
  const channel = new AiReviewChannel(f.store);
  await channel.start();
  try {
    const agent = writeAgent(f.root);
    const main = join(process.cwd(), 'src/main.ts');
    const adapter = new AiAdapter([{
      id: 'acp',
      name: 'ACP',
      kind: 'acp',
      executable: process.execPath,
      args: [agent],
    }], f.git);
    const started = await channel.startReview({
      harnessId: 'acp',
      git: f.git,
      base: f.base,
      head: f.head,
      changedFiles: await f.git.changedFiles(f.base, f.head),
      anchors: new Set(['a.ts\u0000new\u00002']),
      renames: new Map(),
      launch: (env, signal) => adapter.run('acp', 'Review this change', 'patch', {
        env: { ...env, POST_REVIEW: '1', CRIEVER_AI_MAIN: main },
        signal,
      }),
    });
    await started.done;
    expect(await f.store.loadAiReviewRuns()).toHaveLength(1);
    expect((await f.store.loadAiFindings()).map(item => item.body)).toEqual(['authenticated finding']);
  } finally {
    await channel.close();
  }
});

function writeAgent(root: string): string {
  const path = join(root, 'agent.mjs');
  writeFileSync(path, String.raw`
import { appendFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const methodsLog = process.env.METHODS_LOG;
const permissionLog = process.env.PERMISSION_LOG;
const envLog = process.env.ENV_LOG;
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const logMethod = method => methodsLog && appendFileSync(methodsLog, method + '\n');
const recordPromptResult = (id, text) => send({ id, result: { stopReason: 'end_turn' } }) && void text;

if (envLog) {
  const selected = {};
  for (const key of ['CRIEVER_AI_URL', 'CRIEVER_AI_TOKEN', 'CRIEVER_AI_REVIEW_ID', 'CRIEVER_AI_COMMAND']) {
    if (process.env[key]) selected[key] = process.env[key];
  }
  writeFileSync(envLog, JSON.stringify(selected));
}
if (process.env.ARGS_LOG) writeFileSync(process.env.ARGS_LOG, JSON.stringify(process.argv.slice(2)));

const input = createInterface({ input: process.stdin });
let promptId = 0;
for await (const line of input) {
  const message = JSON.parse(line);
  if (message.method) logMethod(message.method);
  if (message.method === 'initialize') {
    send({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } });
  } else if (message.method === 'session/new') {
    send({ id: message.id, result: { sessionId: 'session-1' } });
  } else if (message.method === 'session/prompt') {
    promptId = message.id;
    if (process.env.POST_REVIEW) {
      const main = process.env.CRIEVER_AI_MAIN;
      const post = async (...args) => {
        const child = Bun.spawn([process.execPath, main, '--ai', ...args], { cwd: process.cwd(), env: process.env, stdout: 'pipe', stderr: 'pipe' });
        const code = await child.exited;
        if (code !== 0) throw new Error(await new Response(child.stderr).text());
      };
      await post('status', '--status', 'observing', '--message', 'inspecting');
      await post('observation', '--id', 'obs', '--evidence', 'changed line needs review');
      await post('finding', '--observation-id', 'obs', '--path', 'a.ts', '--line', '2', '--side', 'new', '--severity', 'warning', '--body', 'authenticated finding');
      await post('complete');
      recordPromptResult(promptId, 'done');
    } else if (permissionLog) {
      send({
        id: 99,
        method: 'session/request_permission',
        params: {
          sessionId: 'session-1',
          toolCall: { toolCallId: 'tool-1', title: 'Run command', kind: process.env.TOOL_KIND ?? 'execute', status: 'pending' },
          options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }],
        },
      });
    } else {
      send({ method: 'session/update', params: { sessionId: 'session-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello ' } } } });
      send({ method: 'session/update', params: { sessionId: 'session-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ACP' } } } });
      recordPromptResult(promptId, 'done');
    }
  } else if (message.id === 99 && permissionLog) {
    writeFileSync(permissionLog, JSON.stringify(message.result.outcome));
    send({ method: 'session/update', params: { sessionId: 'session-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'permission denied' } } } });
    recordPromptResult(promptId, 'done');
  }
}
`);
  return path;
}
