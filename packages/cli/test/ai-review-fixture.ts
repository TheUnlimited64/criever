import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Git } from '../src/git';
import { StateStore } from '../src/state';

const shell = async (cwd: string, args: string[]): Promise<string> => {
  const process = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const code = await process.exited;
  if (code !== 0) throw new Error(await new Response(process.stderr).text());
  return (await new Response(process.stdout).text()).trim();
};

export async function fixture(roots: string[]): Promise<{ readonly root: string; readonly base: string; readonly head: string; readonly git: Git; readonly store: StateStore }> {
  const root = mkdtempSync(join(tmpdir(), 'criever-review-channel-'));
  roots.push(root);
  await shell(root, ['init', '-q', '-b', 'main']);
  writeFileSync(join(root, 'a.ts'), 'before\n');
  await shell(root, ['add', '.']);
  await shell(root, ['commit', '-qm', 'base']);
  const base = await shell(root, ['rev-parse', 'HEAD']);
  await shell(root, ['checkout', '-qb', 'feature']);
  writeFileSync(join(root, 'a.ts'), 'before\nchanged\n');
  await shell(root, ['add', '.']);
  await shell(root, ['commit', '-qm', 'feature']);
  const head = await shell(root, ['rev-parse', 'HEAD']);
  const store = new StateStore(join(root, 'state.json'));
  await store.load();
  return { root, base, head, git: new Git(root), store };
}

const quoted = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export function harnessScript(main: string, complete: boolean, exitCode = 0): string {
  const cli = `${quoted(process.execPath)} ${quoted(main)} --ai`;
  const invalidAnchor = `${cli} finding --observation-id obs --path a.ts --line 99 --side new --severity warning --body invalid-anchor`;
  const invalidCapability = `CRIEVER_AI_TOKEN=wrong ${cli} status --status observing`;
  const valid = [
    `${cli} status --status observing --message inspecting`,
    `${cli} observation --id obs --evidence ${quoted('changed line needs review')}`,
    `${invalidAnchor} >/dev/null 2>&1; test "$?" -eq 1 || exit 10`,
    `${invalidCapability} >/dev/null 2>&1; test "$?" -eq 1 || exit 11`,
    `${cli} finding --observation-id obs --path a.ts --line 2 --side new --severity warning --body ${quoted('authenticated finding')}`,
    ...(complete ? [`${cli} complete`] : []),
  ];
  return ['#!/bin/sh', ...valid, `exit ${exitCode}`].join('\n') + '\n';
}
