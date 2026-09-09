import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { startup } from '../src/startup';
import { createHandler } from '../src/server';
import { runCommentsCli } from '../src/cli-comments';
import { LocalReviewStore } from '../src/localreview';

// The full loop end to end: agent adds via the CLI, the server (what the UI talks
// to) shows it, a "human" reply is saved as a draft and then published (the UI's Save button), and
// `criever comments list --json` — a second, independent process in real life — reflects both.
const sh = async (cwd: string, args: string[]) => { const p = Bun.spawn(['git', ...args], { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, stdout: 'pipe', stderr: 'pipe' }); await p.exited; return (await new Response(p.stdout).text()).trim(); };
const captureLogs = () => {
  const out: string[] = []; const orig = console.log;
  console.log = (...a: unknown[]) => out.push(a.join(' '));
  return { out, restore: () => { console.log = orig; } };
};

let dir: string;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

describe('the agent loop, end to end', () => {
  it('CLI add → server shows it → human reply published → CLI list --json shows the nested reply', async () => {
    dir = mkdtempSync(join(tmpdir(), 'criever-agentloop-'));
    await sh(dir, ['init', '-q', '-b', 'main']);
    writeFileSync(join(dir, 'a.ts'), 'l1\nl2\nl3\n');
    await sh(dir, ['add', '.']); await sh(dir, ['commit', '-qm', 'base']);
    const base = await sh(dir, ['rev-parse', 'HEAD']);
    writeFileSync(join(dir, 'a.ts'), 'l1\nl2x\nl3\n');
    await sh(dir, ['add', '.']); await sh(dir, ['commit', '-qm', 'feat']);
    const head = await sh(dir, ['rev-parse', 'HEAD']);
    const seedStore = new LocalReviewStore(LocalReviewStore.path(dir)); await seedStore.load(); await seedStore.ensureReview(base, head);

    // 1. the agent finds something and adds it via the CLI, no server running
    const cap = captureLogs();
    const addCode = await runCommentsCli(['comment', 'add', '--path', 'a.ts', '--line', '2', '--body', 'this looks off', '--agent-name', 'coding-agent'], dir);
    cap.restore();
    expect(addCode).toBe(0);

    // 2. the UI's server picks it up
    const stateDir = join(dir, 'state');
    const deps = await startup({ cwd: dir, log: () => {}, env: { CRIEVER_STATE_DIR: stateDir }, local: true, base, head });
    const handler = createHandler({ ...deps, staticDir: null, vscode: null });
    const before = await (await handler(new Request('http://x/api/comments'))).json();
    expect(before.threads).toHaveLength(1);
    const agentCommentId = before.threads[0].root.id;
    expect(before.threads[0].root.author).toMatchObject({ name: 'coding-agent', isMe: false });

    // 3. the human replies — the UI saves this as a draft first
    await handler(new Request('http://x/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'a.ts', line: 2, side: 'new', body: 'fixed in the next push', parentId: agentCommentId }) }));

    // 4. the human clicks Save — publishDrafts hands it to LocalProvider.publishComment
    const publishRes = await handler(new Request('http://x/api/publish', { method: 'POST' }));
    await publishRes.text(); // drain the ndjson stream so the write completes before we read the file

    // 5. a second, independent CLI invocation (the agent's next turn) sees the reply
    const cap2 = captureLogs();
    const listCode = await runCommentsCli(['comments', 'list', '--json'], dir);
    cap2.restore();
    expect(listCode).toBe(0);
    const shape = JSON.parse(cap2.out.join(''));
    expect(shape).toHaveLength(1);
    expect(shape[0]).toMatchObject({ id: agentCommentId, author: 'agent', agentName: 'coding-agent' });
    expect(shape[0].replies).toEqual([{ id: expect.any(Number), author: 'me', body: 'fixed in the next push' }]);
  });
});
