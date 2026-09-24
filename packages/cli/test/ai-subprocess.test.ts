import { afterEach, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiAdapter } from '../src/ai';
import { Git } from '../src/git';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('confines Codex patch analysis without disabling plugins for ordinary chat', async () => {
  const root = mkdtempSync(join(tmpdir(), 'criever-codex-'));
  dirs.push(root);
  const executable = join(root, 'codex.sh');
  writeFileSync(executable, '#!/bin/sh\nprintf \'{"type":"item.completed","item":{"type":"agent_message","text":"%s"}}\\n\' "$*"\n');
  chmodSync(executable, 0o755);
  const adapter = new AiAdapter([{ id: 'codex', name: 'Codex', kind: 'codex', executable }], new Git(root));

  const patch = await adapter.run('codex', 'Check this patch', 'patch');
  const chat = await adapter.run('codex', 'Explain this file');

  expect(patch).toContain('--sandbox read-only --json -');
  expect(patch).toContain('features.plugins=false');
  expect(patch).toContain('--disable multi_agent');
  expect(chat).not.toContain('features.plugins=false');
  expect(chat).not.toContain('--disable multi_agent');
});
