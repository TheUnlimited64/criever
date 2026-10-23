import { afterEach, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiAdapter, reviewPrompt } from '../src/ai';
import { Git } from '../src/git';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('allows Codex review setup in the workspace with registry access while keeping chat read-only', async () => {
  const root = mkdtempSync(join(tmpdir(), 'criever-codex-'));
  dirs.push(root);
  const executable = join(root, 'codex.sh');
  writeFileSync(executable, '#!/bin/sh\nif [ -n "$ARGS_LOG" ]; then printf "%s" "$*" > "$ARGS_LOG"; fi\nprintf \'{"type":"item.completed","item":{"type":"agent_message","text":"%s"}}\\n\' "$*"\n');
  chmodSync(executable, 0o755);
  const adapter = new AiAdapter([{ id: 'codex', name: 'Codex', kind: 'codex', executable }], new Git(root));

  const argsLog = join(root, 'args.log');
  const patch = await adapter.run('codex', 'Check this patch', 'patch', { env: { ARGS_LOG: argsLog, CRIEVER_AI_COMMAND: '/bin/criever --ai', CRIEVER_AI_URL: 'http://127.0.0.1:4955/review' } });
  const patchArgs = readFileSync(argsLog, 'utf8');
  const chat = await adapter.run('codex', 'Explain this file');

  expect(patch).toBe('');
  expect(patchArgs).not.toContain('--sandbox read-only');
  expect(patchArgs).toContain('--json');
  expect(patchArgs).toContain('permissions.criever_review.extends=":workspace"');
  expect(patchArgs).toContain('permissions.criever_review.network.enabled=true');
  expect(chat).toContain('--sandbox read-only');
  expect(patchArgs).toContain('default_permissions="criever_review"');
  expect(patchArgs).toContain('permissions.criever_review.network.domains={"127.0.0.1"="allow","*"="allow"}');
  expect(patchArgs).not.toContain('features.plugins=false');
  expect(chat).toContain('features.plugins=false');
  expect(chat).toContain('--disable multi_agent');
});

it('allows OpenCode dependency setup and checks without disabling review plugins', async () => {
  const root = mkdtempSync(join(tmpdir(), 'criever-opencode-'));
  dirs.push(root);
  const executable = join(root, 'opencode.sh');
  writeFileSync(executable, '#!/bin/sh\nARGS="$*" bun -e \'import { writeFileSync } from "node:fs"; writeFileSync(process.env.ARGS_LOG, JSON.stringify({permission:JSON.parse(process.env.OPENCODE_PERMISSION ?? "{}"),args:process.env.ARGS})); console.log("this is not review data")\'\n');
  chmodSync(executable, 0o755);
  const adapter = new AiAdapter([{ id: 'opencode', name: 'OpenCode', kind: 'opencode', executable }], new Git(root));

  const argsLog = join(root, 'args.log');
  const patch = await adapter.run('opencode', 'Review the changes', 'patch', { env: { ARGS_LOG: argsLog, CRIEVER_AI_COMMAND: '/bin/criever --ai', CRIEVER_AI_URL: 'http://127.0.0.1:4955/review' } });
  const invocation = JSON.parse(readFileSync(argsLog, 'utf8')) as { permission: { edit: string; bash: Record<string, string> }; args: string };
  expect(patch).toBe('');
  expect(invocation.permission.edit).toBe('deny');
  expect(invocation.permission.bash['*']).toBe('allow');
  expect(invocation.args).toContain('run --agent build --format json');
  expect(invocation.args).not.toContain('--pure');
});

it('allows Claude review setup and network access inside the sandbox', async () => {
  const root = mkdtempSync(join(tmpdir(), 'criever-claude-'));
  dirs.push(root);
  const executable = join(root, 'claude.sh');
  writeFileSync(executable, '#!/bin/sh\nprintf "%s" "$*" > "$ARGS_LOG"\n');
  chmodSync(executable, 0o755);
  const adapter = new AiAdapter([{ id: 'claude', name: 'Claude', kind: 'claude', executable }], new Git(root));

  const argsLog = join(root, 'args.log');
  await adapter.run('claude', 'Review the changes', 'patch', { env: { ARGS_LOG: argsLog, CRIEVER_AI_URL: 'http://127.0.0.1:4955/review' } });
  const args = readFileSync(argsLog, 'utf8');
  expect(args).toContain('"allowedDomains":["127.0.0.1","*"]');
  expect(args).toContain('"Bash"');
  expect(args).toContain('"enabled":true');
  expect(args).toContain('"allowUnsandboxedCommands":false');
  expect(args).toContain(JSON.stringify({ denyWrite: [join(root, '.git')] }));
  expect(args).not.toContain('allowUnixSockets');
});

it('lets a thorough OpenCode review continue beyond five minutes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'criever-long-review-'));
  dirs.push(root);
  const executable = join(root, 'opencode.sh');
  writeFileSync(executable, '#!/bin/sh\nsleep 0.2\nprintf \'%s\\n\' \'{"type":"text","part":{"text":"Completed review"}}\'\n');
  chmodSync(executable, 0o755);
  const adapter = new AiAdapter([{ id: 'opencode', name: 'OpenCode', kind: 'opencode', executable }], new Git(root));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const review = adapter.run('opencode', 'Check the full change', 'patch', { env: { CRIEVER_AI_URL: 'http://127.0.0.1:4955/review' } });
    vi.advanceTimersByTime(300_001);
    await expect(review).resolves.toBe('');
  } finally { vi.useRealTimers(); }
});

it('stops an active harness before session cleanup and rejects new work', async () => {
  const root = mkdtempSync(join(tmpdir(), 'criever-ai-stop-'));
  dirs.push(root);
  const ready = join(root, 'ready');
  const script = join(root, 'wait.ts');
  writeFileSync(script, `await Bun.write(${JSON.stringify(ready)}, 'ready'); await Bun.sleep(60_000);`);
  const executable = join(root, 'harness');
  writeFileSync(executable, `#!/bin/sh\nexec "${process.execPath}" "${script}"\n`, { mode: 0o755 });
  const adapter = new AiAdapter([{ id: 'test', name: 'Test', kind: 'claude', executable }], new Git(root));
  const outcome = adapter.run('test', 'Wait').then(() => 'unexpected success', () => 'stopped');
  await vi.waitFor(() => expect(readFileSync(ready, 'utf8')).toBe('ready'));
  await adapter.stop();
  expect(await outcome).toBe('stopped');
  await expect(adapter.run('test', 'New question')).rejects.toThrow('shutting down');
});

it('instructs fresh checkout reviews to install pinned dependencies and preserve user changes', () => {
  const prompt = reviewPrompt('diff', 'base-sha', 'head-sha');
  expect(prompt).toContain('install them rather than stopping at missing packages');
  expect(prompt).toContain('frozen-lockfile');
  expect(prompt).toContain('writable temporary directory');
  expect(prompt).toContain('separate temporary checkout of the pinned revision');
  expect(prompt).toContain("never reset or clean the user's worktree");
  expect(prompt).not.toContain('Do not install dependencies');
});

it('lets private questions think beyond two minutes and reports response activity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'criever-long-chat-'));
  dirs.push(root);
  const executable = join(root, 'harness.sh');
  writeFileSync(executable, '#!/bin/sh\nsleep 0.2\nprintf "<answer>Done</answer>"\n', { mode: 0o755 });
  const adapter = new AiAdapter([{ id: 'test', name: 'Test', kind: 'claude', executable }], new Git(root));
  const progress: string[] = [];
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const answer = adapter.run('test', 'Think carefully', 'chat', { onProgress: message => progress.push(message) });
    vi.advanceTimersByTime(120_001);
    await expect(answer).resolves.toBe('<answer>Done</answer>');
    expect(progress).toEqual(['Thinking about your question', 'Receiving AI response']);
  } finally { vi.useRealTimers(); }
});
