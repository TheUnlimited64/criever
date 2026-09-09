import { describe, it, expect, afterAll } from 'vitest';
const proc = Bun.spawn(['bun', 'run', 'fixtures/harness.ts', '--port', '4798'], { cwd: new URL('..', import.meta.url).pathname, stdout: 'pipe', stderr: 'inherit' });
afterAll(() => proc.kill());

describe('harness', () => {
  it('serves the fixture PR with the mockup state', async () => {
    const reader = proc.stdout.getReader(); const { value } = await reader.read();
    const info = JSON.parse(new TextDecoder().decode(value).split('\n')[0]!);
    expect(info.url).toBe('http://127.0.0.1:4798');
    const pr = await (await fetch(`${info.url}/api/pr`)).json();
    expect(pr).toMatchObject({ id: 241, sourceBranch: 'feat/virtual-list-review', destinationBranch: 'main' });
    expect(pr.commits).toHaveLength(3); expect(pr.lastSeenHead).toBe(pr.commits.find((c: { message: string }) => c.message === 'wire windowed rows').hash);
    const files = await (await fetch(`${info.url}/api/files`)).json();
    const byPath = Object.fromEntries(files.map((f: { path: string }) => [f.path, f]));
    expect(byPath['src/devices/DeviceList.tsx']).toMatchObject({ status: 'M', changedCount: 1, openCount: 1 });
    expect(byPath['src/devices/useDeviceRows.ts']).toMatchObject({ status: 'A' });
    expect(byPath['src/hooks/useIntersection.ts']).toMatchObject({ status: 'D' });
    expect(byPath['src/devices/DeviceRow.tsx']).toMatchObject({ viewed: true });
    const c = await (await fetch(`${info.url}/api/comments`)).json();
    const t301 = c.threads.find((t: { root: { id: number } }) => t.root.id === 301);
    expect(t301.status.status).toBe('changed'); expect(t301.replies).toHaveLength(2);
    // 308 replies to 302 (a reply, not the root) — depth-2 nesting must still land in this thread.
    expect(t301.replies.map((r: { id: number }) => r.id)).toEqual([302, 308]);
    expect(c.threads.find((t: { root: { id: number } }) => t.root.id === 305).root.resolved).toBe(true);
    // stub records publishes and can be reset
    const rec = await (await fetch(`${info.stubBase}/__recorded`)).json(); expect(rec).toEqual([]);
  });
});
