import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const roots: string[] = [];
const children: ReturnType<typeof Bun.spawn>[] = [];
const entry = new URL('../src/main.ts', import.meta.url).pathname;

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill('SIGTERM');
    await child.exited;
  }
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

it('starts a persistent project workspace outside a git repository and shuts down on signal', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'criever-daemon-cli-'));
  roots.push(cwd);
  const child = Bun.spawn([process.execPath, entry, 'daemon', '--no-open', '--port', '0', '--dev'], {
    cwd, env: { ...process.env, CRIEVER_STATE_DIR: join(cwd, 'state'), CRIEVER_CACHE_DIR: join(cwd, 'cache') },
    stdout: 'pipe', stderr: 'pipe',
  });
  children.push(child);
  const reader = child.stderr.getReader();
  const decoder = new TextDecoder();
  let log = '';
  let address: string | undefined;
  try {
    while (!address) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error(`Daemon exited before readiness: ${log}`);
      log += decoder.decode(chunk.value, { stream: true });
      address = log.match(/criever daemon ready: (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    }
  } finally {
    reader.releaseLock();
  }
  const response = await fetch(`${address}/api/workspace`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ projects: [] });
  child.kill('SIGTERM');
  expect(await child.exited).toBe(0);
}, 15000);

it.each([
  ['daemon', '--local'],
  ['--daemon', '--base', 'main'],
  ['--daemon', '--port', '-1'],
  ['--daemon', '--port', 'not-a-port'],
])('rejects incompatible or invalid daemon arguments: %j', async (...args) => {
  const child = Bun.spawn([process.execPath, entry, ...args, '--no-open'], { stdout: 'pipe', stderr: 'pipe' });
  children.push(child);
  const [, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  expect(code).toBe(1);
});
