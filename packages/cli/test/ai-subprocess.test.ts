import { afterEach, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiAdapter } from '../src/ai';
import { Git } from '../src/git';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('keeps Codex read-only while allowing review skills to orchestrate review work', async () => {
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
  expect(patchArgs).toContain('default_permissions="criever_review"');
  expect(patchArgs).toContain('permissions.criever_review.network.domains={"127.0.0.1"="allow"}');
  expect(patchArgs).not.toContain('features.plugins=false');
  expect(chat).toContain('features.plugins=false');
  expect(chat).toContain('--disable multi_agent');
});

it('keeps OpenCode reviews read-only without disabling review plugins', async () => {
  const root = mkdtempSync(join(tmpdir(), 'criever-opencode-'));
  dirs.push(root);
  const executable = join(root, 'opencode.sh');
  writeFileSync(executable, '#!/bin/sh\nARGS="$*" bun -e \'import { writeFileSync } from "node:fs"; writeFileSync(process.env.ARGS_LOG, JSON.stringify({permission:JSON.parse(process.env.OPENCODE_PERMISSION ?? "{}"),args:process.env.ARGS})); console.log("this is not review data")\'\n');
  chmodSync(executable, 0o755);
  const adapter = new AiAdapter([{ id: 'opencode', name: 'OpenCode', kind: 'opencode', executable }], new Git(root));

  const argsLog = join(root, 'args.log');
  const patch = await adapter.run('opencode', 'Review the changes', 'patch', { env: { ARGS_LOG: argsLog, CRIEVER_AI_COMMAND: '/bin/criever --ai', CRIEVER_AI_SOCKET: '/tmp/review.sock' } });
  const invocation = JSON.parse(readFileSync(argsLog, 'utf8')) as { permission: { edit: string; bash: Record<string, string> }; args: string };
  expect(patch).toBe('');
  expect(invocation.permission.edit).toBe('deny');
  expect(invocation.permission.bash['*']).toBe('deny');
  expect(invocation.permission.bash['/bin/criever --ai *']).toBe('allow');
  expect(invocation.args).toContain('run --agent build --format json');
  expect(invocation.args).not.toContain('--pure');
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
    const review = adapter.run('opencode', 'Check the full change', 'patch', { env: { CRIEVER_AI_SOCKET: '/tmp/review.sock' } });
    vi.advanceTimersByTime(300_001);
    await expect(review).resolves.toBe('');
  } finally { vi.useRealTimers(); }
});
