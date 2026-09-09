import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { createVscode, installDir, openUrl, platformTag, VSCODE_VERSION } from '../src/vscode';

describe('vscode helpers', () => {
  it('platformTag is one of the supported tags', () => expect(['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64']).toContain(platformTag()));
  it('installDir layout', () => expect(installDir('/c', '1.2.3')).toBe(`/c/openvscode-server-v1.2.3-${platformTag()}`));
  it('openUrl encodes folder and payload', () => {
    const u = new URL(openUrl(4321, '/example/review-repo', 'src/a.ts', 7));
    expect(u.searchParams.get('folder')).toBe('/example/review-repo');
    expect(JSON.parse(u.searchParams.get('payload')!)).toEqual([['openFile', 'vscode-remote://localhost/example/review-repo/src/a.ts:7'], ['gotoLineMode', 'true']]);
  });
});

describe('createVscode', () => {
  it('downloads once, spawns once, reuses the running instance, stops', async () => {
    const cache = mkdtempSync(join(tmpdir(), 'vsc-')); const dir = installDir(cache, VSCODE_VERSION);
    let downloads = 0, spawns = 0, killed = 0;
    const fakeFetch = (async () => { downloads++; return new Response(new Uint8Array([1, 2, 3])); }) as unknown as typeof fetch;
    const fakeSpawn = ((cmd: string[]) => {
      if (cmd[0] === 'tar') { mkdirSync(join(dir, 'bin'), { recursive: true }); writeFileSync(join(dir, 'bin/openvscode-server'), ''); return { exited: Promise.resolve(0), stdout: null, stderr: null } as unknown as ReturnType<typeof Bun.spawn>; }
      spawns++;
      const stdout = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('Web UI available at http://127.0.0.1:45678/\n')); } });
      return { exited: new Promise(() => {}), stdout, stderr: null, kill: () => { killed++; }, pid: 1 } as unknown as ReturnType<typeof Bun.spawn>;
    }) as unknown as typeof Bun.spawn;
    const v = createVscode({ repoRoot: '/r', cacheDir: cache, log: () => {}, spawn: fakeSpawn, fetch: fakeFetch, waitForPort: async () => {} });
    const u1 = await v.open('a.ts', 3); const u2 = await v.open('b.ts', 9);
    expect(u1).toContain('45678'); expect(u1).toContain('a.ts:3'); expect(u2).toContain('b.ts:9');
    expect(downloads).toBe(1); expect(spawns).toBe(1); expect(existsSync(join(dir, 'bin/openvscode-server'))).toBe(true);
    await v.stop(); expect(killed).toBe(1);
  });
});
