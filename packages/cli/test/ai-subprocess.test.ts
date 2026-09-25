import { afterEach, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  writeFileSync(executable, '#!/bin/sh\nprintf \'{"type":"item.completed","item":{"type":"agent_message","text":"%s"}}\\n\' "$*"\n');
  chmodSync(executable, 0o755);
  const adapter = new AiAdapter([{ id: 'codex', name: 'Codex', kind: 'codex', executable }], new Git(root));

  const patch = await adapter.run('codex', 'Check this patch', 'patch');
  const chat = await adapter.run('codex', 'Explain this file');

  expect(patch).toContain('--sandbox read-only --json -');
  expect(patch).not.toContain('features.plugins=false');
  expect(patch).not.toContain('--disable multi_agent');
  expect(chat).toContain('features.plugins=false');
  expect(chat).toContain('--disable multi_agent');
});

it('limits OpenCode reviews to read-only tools without limiting chat', async () => {
  const root = mkdtempSync(join(tmpdir(), 'criever-opencode-'));
  dirs.push(root);
  const executable = join(root, 'opencode.sh');
  writeFileSync(executable, '#!/bin/sh\nARGS="$*" bun -e \'console.log(JSON.stringify({type:"text",part:{text:JSON.stringify({permission:JSON.parse(process.env.OPENCODE_PERMISSION ?? "{}"),args:process.env.ARGS})}}))\'\n');
  chmodSync(executable, 0o755);
  const adapter = new AiAdapter([{ id: 'opencode', name: 'OpenCode', kind: 'opencode', executable }], new Git(root));

  const patch = JSON.parse(await adapter.run('opencode', 'Review the changes', 'patch')) as { permission: { edit: string; bash: string }; args: string };
  expect(patch.permission.edit).toBe('deny');
  expect(patch.permission.bash).toBe('deny');
  expect(patch.args).toContain('--pure --agent build --format json');
});
