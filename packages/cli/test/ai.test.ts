import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Git } from '../src/git';
import { StateStore } from '../src/state';
import { AiAdapter, parseFindings, parseHarnessOutput, parseReviewResult, type AiRunner } from '../src/ai';
import { aiEndpoint } from '../src/ai-routes';
import { createHandler } from '../src/server';
import type { Provider } from '../src/provider';
import type { ReviewMeta } from '@criever/shared';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const sh = async (cwd: string, args: string[]) => {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com' } });
  const code = await proc.exited;
  if (code !== 0) throw new Error(await new Response(proc.stderr).text());
  return (await new Response(proc.stdout).text()).trim();
};
const fixture = async () => {
  const root = mkdtempSync(join(tmpdir(), 'criever-ai-')); dirs.push(root);
  await sh(root, ['init', '-q', '-b', 'main']); writeFileSync(join(root, 'a.ts'), 'const before = 1;\n'); writeFileSync(join(root, 'removed.ts'), 'const obsolete = true;\n'); writeFileSync(join(root, 'old-name.ts'), 'const value = 1;\nconst second = true;\nconst third = true;\nconst fourth = true;\n'); await sh(root, ['add', '.']); await sh(root, ['commit', '-qm', 'base']);
  const base = await sh(root, ['rev-parse', 'HEAD']); await sh(root, ['checkout', '-qb', 'feature']);
  writeFileSync(join(root, 'a.ts'), 'const before = 2;\nconst changed = true;\n'); rmSync(join(root, 'removed.ts')); await sh(root, ['mv', 'old-name.ts', 'new-name.ts']); writeFileSync(join(root, 'new-name.ts'), 'const value = 2;\nconst second = true;\nconst third = true;\nconst fourth = true;\n'); await sh(root, ['add', '.']); await sh(root, ['commit', '-qm', 'feature']);
  const head = await sh(root, ['rev-parse', 'HEAD']);
  const store = new StateStore(join(root, 'private-state.json')); await store.load();
  const inputs: string[] = [];
  const runner: AiRunner = { list: () => [{ id: 'fake', name: 'Fake', kind: 'codex' }], run: async (_id, input) => { inputs.push(input); return '{"findings":[{"path":"a.ts","line":2,"side":"new","body":"Check this","severity":"warning"}],"lookouts":[{"path":"a.ts","line":2,"side":"new","body":"Watch regressions"}]}'; } };
  const meta: ReviewMeta = { id: 42, title: 'Test', url: null, author: 'you', description: null, sourceBranch: 'feature', sourceHead: head, destinationBranch: 'main', destinationHead: base };
  return { root, base, head, git: new Git(root), store, runner, inputs, meta };
};
const request = (method: string, path: string, body?: unknown) => new Request(`http://local${path}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
const handlerFor = (fixtureData: Awaited<ReturnType<typeof fixture>>, kind: 'local' | 'bitbucket', published: string[]) => {
  const provider: Provider = { kind, meta: async () => fixtureData.meta, listComments: async () => [], listCommits: async () => [], publishComment: async body => { published.push(body.raw); return 500; }, resolveComment: async () => {} };
  return createHandler({ git: fixtureData.git, store: fixtureData.store, provider, ws: 'workspace', repo: 'repo', meta: fixtureData.meta, mergeBase: fixtureData.base, comments: [], commits: [], remote: '', staticDir: null, vscode: null, ai: fixtureData.runner });
};

describe('AI review HTTP contract', () => {
  it('rejects cross-origin and non-JSON AI review requests before launching a harness', async () => {
    const f = await fixture();
    const handler = handlerFor(f, 'bitbucket', []);
    const payload = JSON.stringify({ harnessId: 'fake' });
    const foreign = await handler(new Request('http://local/api/ai/review', { method: 'POST', headers: { origin: 'https://untrusted.example', 'content-type': 'text/plain' }, body: payload }));
    expect(foreign.status).toBe(403);
    const plain = await handler(new Request('http://local/api/ai/review', { method: 'POST', headers: { origin: 'http://local', 'content-type': 'text/plain' }, body: payload }));
    expect(plain.status).toBe(415);
    const ordinaryDraft = await handler(new Request('http://local/api/drafts', { method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify({ path: 'src/demo.ts', line: 1, side: 'new', body: 'Normal review' }) }));
    expect(ordinaryDraft.status).toBe(200);
    expect(f.inputs).toEqual([]);
  });

  it.each(['local', 'bitbucket'] as const)('%s mode keeps line Q&A private with source code context', async kind => {
    const f = await fixture();
    const published: string[] = [];
    const handler = handlerFor(f, kind, published);
    const response = await handler(request('POST', '/api/ai/chat', { harnessId: 'fake', message: 'Explain this', path: 'a.ts', line: 2 }));
    expect(response?.status).toBe(200);
    expect(f.inputs[0]).toContain('const changed = true;');
    expect((await f.store.loadAiThreads())[ `a.ts:new:2:${f.head}`]?.map(message => message.role)).toEqual(['user', 'assistant']);
    await handler(request('POST', '/api/ai/chat', { harnessId: 'fake', message: 'Different line', path: 'a.ts', line: 1 }));
    expect((await f.store.loadAiThreads())[ `a.ts:new:1:${f.head}`]?.map(message => message.content)).toEqual(['Different line', '{"findings":[{"path":"a.ts","line":2,"side":"new","body":"Check this","severity":"warning"}],"lookouts":[{"path":"a.ts","line":2,"side":"new","body":"Watch regressions"}]}']);
    expect((await f.store.loadAiThreads())[ `a.ts:new:2:${f.head}`]).toHaveLength(2);
    expect(f.store.state.drafts).toEqual([]);
    expect(published).toEqual([]);
  });

  it('supports general chat, and keeps old-side questions in the base revision thread', async () => {
    const f = await fixture(); const sent: string[] = [];
    const adapter: AiRunner = { ...f.runner, run: async (_id, prompt) => { sent.push(prompt); return 'reply'; } };
    const deps = { adapter, store: f.store, git: f.git, meta: f.meta, base: f.base };
    const general = await aiEndpoint(request('POST', '/api/ai/chat', { harnessId: 'fake', message: 'General question' }), '/api/ai/chat', deps);
    expect(general?.status).toBe(200);
    const oldLine = await aiEndpoint(request('POST', '/api/ai/chat', { harnessId: 'fake', message: 'Why was this removed?', path: 'a.ts', line: 1, side: 'old' }), '/api/ai/chat', deps);
    expect(oldLine?.status).toBe(200);
    expect(sent[1]).toContain('const before = 1;');
    expect(sent[1]).not.toContain('const before = 2;');
    expect((await oldLine?.json() as { threadId: string }).threadId).toBe(`a.ts:old:1:${f.base}`);
    expect(Object.keys(await f.store.loadAiThreads())).toEqual([`general:${f.head}`, `a.ts:old:1:${f.base}`]);
  });

  it('answers a private file question using the whole head-revision file, separately from line threads', async () => {
    const f = await fixture();
    const handler = handlerFor(f, 'local', []);
    const response = await handler(request('POST', '/api/ai/chat', { harnessId: 'fake', message: 'Why did this file change?', path: 'a.ts' }));
    expect(response.status).toBe(200);
    expect((await response.json() as { threadId: string }).threadId).toBe(`file:${encodeURIComponent('a.ts')}:${f.head}`);
    expect(f.inputs[0]).toContain('const changed = true;');
    expect(f.inputs[0]).not.toContain('const before = 1;');
    expect(Object.keys(await f.store.loadAiThreads())).toEqual([`file:${encodeURIComponent('a.ts')}:${f.head}`]);
  });

  it('preserves both exchanges when questions in one thread complete concurrently', async () => {
    const f = await fixture();
    const pending: ((answer: string) => void)[] = [];
    let ready = () => {};
    const started = new Promise<void>(resolve => { ready = resolve; });
    const runner: AiRunner = { ...f.runner, run: async () => new Promise<string>(resolve => { pending.push(resolve); if (pending.length === 2) ready(); }) };
    const deps = { adapter: runner, store: f.store, git: f.git, meta: f.meta, base: f.base };
    const first = aiEndpoint(request('POST', '/api/ai/chat', { harnessId: 'fake', message: 'First question' }), '/api/ai/chat', deps);
    const second = aiEndpoint(request('POST', '/api/ai/chat', { harnessId: 'fake', message: 'Second question' }), '/api/ai/chat', deps);
    await started;
    pending[0]?.('First answer'); pending[1]?.('Second answer');
    const responses = await Promise.all([first, second]);
    expect(responses.map(response => response?.status)).toEqual([200, 200]);
    expect((await f.store.loadAiThreads())[`general:${f.head}`]?.map(message => message.content)).toEqual(['First question', 'First answer', 'Second question', 'Second answer']);
  });

  it('retains overlapping review runs and chat when reviews finish out of order', async () => {
    const f = await fixture();
    const pending: ((answer: string) => void)[] = [];
    let bothStarted = () => {};
    const started = new Promise<void>(resolve => { bothStarted = resolve; });
    const runner: AiRunner = { ...f.runner, run: async (_id, prompt) => {
      if (prompt.includes('\n\nConversation:\n')) return '**Chat answered**';
      return new Promise<string>(resolve => { pending.push(resolve); if (pending.length === 2) bothStarted(); });
    } };
    const deps = { adapter: runner, store: f.store, git: f.git, meta: f.meta, base: f.base };
    const first = aiEndpoint(request('POST', '/api/ai/review', { harnessId: 'fake' }), '/api/ai/review', deps);
    const second = aiEndpoint(request('POST', '/api/ai/review', { harnessId: 'fake' }), '/api/ai/review', deps);
    await started;
    const reviewOutput = (label: string) => JSON.stringify({ findings: [{ path: 'a.ts', line: 2, side: 'new', body: label, severity: 'warning' }], lookouts: [] });
    pending[1]?.(reviewOutput('Second run'));
    await second;
    const secondFinding = (await f.store.loadAiFindings()).find(item => item.body === 'Second run');
    expect(secondFinding).toBeDefined();
    await aiEndpoint(request('PATCH', `/api/ai/findings/${secondFinding?.id}`, { body: 'Edited second run' }), `/api/ai/findings/${secondFinding?.id}`, deps);
    const chat = await aiEndpoint(request('POST', '/api/ai/chat', { harnessId: 'fake', message: 'What else changed?' }), '/api/ai/chat', deps);
    expect(chat?.status).toBe(200);
    pending[0]?.(reviewOutput('First run'));
    await first;
    const reopened = new StateStore(join(f.root, 'private-state.json')); await reopened.load();
    expect((await reopened.loadAiFindings()).map(item => item.body).sort()).toEqual(['Edited second run', 'First run']);
    expect(reopened.state.aiReviewRuns).toHaveLength(2);
    expect(new Set(reopened.state.aiReviewRuns?.map(run => run.id)).size).toBe(2);
    expect((await reopened.loadAiThreads())[`general:${f.head}`]?.map(message => message.content)).toEqual(['What else changed?', '**Chat answered**']);
  });

  it('passes review-size prompts through stdin without the OS argument limit', async () => {
    const f = await fixture();
    const executable = join(f.root, 'harness.sh');
    writeFileSync(executable, '#!/bin/sh\nbytes=$(wc -c)\nprintf \'{"type":"text","part":{"text":"%s"}}\\n\' "$bytes"\n');
    chmodSync(executable, 0o755);
    const runner = new AiAdapter([{ id: 'large', name: 'Large prompt', kind: 'opencode', executable }], f.git);
    expect(await runner.run('large', 'x'.repeat(150_000))).toBe('150000');
    await expect(runner.run('large', 'x'.repeat(2_000_001))).rejects.toThrow('input');
  });

  it('does not crash when a harness exits before consuming a large prompt', async () => {
    const f = await fixture();
    const executable = join(f.root, 'exit.sh');
    writeFileSync(executable, '#!/bin/sh\nexit 1\n');
    chmodSync(executable, 0o755);
    const runner = new AiAdapter([{ id: 'early', name: 'Early exit', kind: 'claude', executable }], f.git);
    await expect(runner.run('early', 'x'.repeat(150_000))).rejects.toThrow('AI harness exited with status 1');
    await new Promise(resolve => setTimeout(resolve, 30));
  });

  it('rewords a finding through the selected harness and can save an independent lookout', async () => {
    const f = await fixture(); const sent: string[] = []; const harnessIds: string[] = [];
    const adapter: AiRunner = { ...f.runner, run: async (id, prompt) => { sent.push(prompt); harnessIds.push(id); if (prompt.includes('{"finding":')) return 'Keep this robust'; return '{"findings":[{"path":"a.ts","line":2,"side":"new","body":"Check this","severity":"warning"}],"lookouts":[{"path":"a.ts","line":2,"side":"new","body":"Watch API compatibility"}] }'; } };
    const deps = { adapter, store: f.store, git: f.git, meta: f.meta, base: f.base };
    const review = await aiEndpoint(request('POST', '/api/ai/review', { harnessId: 'fake' }), '/api/ai/review', deps);
    const reviewResult = await review?.json() as { findings: { id: string; body: string }[]; lookouts: { id: string; body: string }[] };
    expect(reviewResult.lookouts).toEqual([expect.objectContaining({ body: 'Watch API compatibility' })]);
    const reword = await aiEndpoint(request('POST', `/api/ai/findings/${reviewResult.findings[0]?.id}/reword`, { harnessId: 'fake' }), `/api/ai/findings/${reviewResult.findings[0]?.id}/reword`, deps);
    expect((await reword?.json() as { body: string }).body).toBe('Keep this robust');
    expect(JSON.parse((sent[1] ?? '{}').slice((sent[1] ?? '{}').indexOf('{')))).toMatchObject({ finding: 'Check this', path: 'a.ts', line: 2, context: expect.stringContaining('const changed = true;') });
    expect(harnessIds[1]).toBe('fake');
    expect((await f.store.loadAiFindings())[0]?.body).toBe('Check this');
    expect((await f.store.loadAiLookouts())[0]).toMatchObject({ path: 'a.ts', line: 2, side: 'new' });
  });

  it('persists review findings and separate lookouts; supports edit and delete', async () => {
    const f = await fixture(); const deps = { adapter: f.runner, store: f.store, git: f.git, meta: f.meta, base: f.base };
    const reviewed = await aiEndpoint(request('POST', '/api/ai/review', { harnessId: 'fake' }), '/api/ai/review', deps);
    const body = await reviewed?.json() as { findings: { id: string }[]; lookouts: { id: string; findingId: string }[] };
    expect(body.findings).toHaveLength(1); expect(body.lookouts).toHaveLength(1);
    const reopened = new StateStore(join(f.root, 'private-state.json')); await reopened.load();
    expect((await reopened.loadAiFindings()).map(item => item.id)).toEqual(body.findings.map(item => item.id));
    expect(await reopened.loadAiLookouts()).toEqual(body.lookouts);
    const id = body.findings[0]?.id;
    const edited = await aiEndpoint(request('PATCH', `/api/ai/findings/${id}`, { body: 'Reworded finding' }), `/api/ai/findings/${id}`, deps);
    expect((await edited?.json() as { finding: { body: string } }).finding.body).toBe('Reworded finding');
    expect((await f.store.loadAiFindings())[0]?.body).toBe('Reworded finding');
    const lookoutId = body.lookouts[0]?.id;
    const editedLookout = await aiEndpoint(request('PATCH', `/api/ai/lookouts/${lookoutId}`, { body: 'Watch this behavior' }), `/api/ai/lookouts/${lookoutId}`, deps);
    expect((await editedLookout?.json() as { lookout: { body: string } }).lookout.body).toBe('Watch this behavior');
    await aiEndpoint(request('DELETE', `/api/ai/findings/${id}`), `/api/ai/findings/${id}`, deps);
    expect(await f.store.loadAiFindings()).toEqual([]);
    expect(await f.store.loadAiLookouts()).toEqual([expect.objectContaining({ body: 'Watch this behavior' })]);
  });

  it.each(['local', 'bitbucket'] as const)('%s mode requires explicit one-time approval to publish one finding', async kind => {
    const f = await fixture(); const published: string[] = [];
    const handler = handlerFor(f, kind, published);
    await handler(request('POST', '/api/ai/review', { harnessId: 'fake' }));
    expect(f.store.state.drafts).toEqual([]);
    const noApproval = await handler(request('POST', '/api/publish'));
    await noApproval.text();
    expect(published).toEqual([]);
    const finding = (await f.store.loadAiFindings())[0];
    const attempts = await Promise.all([handler(request('POST', `/api/ai/findings/${finding?.id}/approve`)), handler(request('POST', `/api/ai/findings/${finding?.id}/approve`))]);
    expect(attempts.map(response => response.status).sort()).toEqual([200, 409]);
    expect(f.store.state.drafts.map(draft => draft.body)).toEqual(['Check this']);
    const afterApproval = await handler(request('POST', '/api/publish'));
    await afterApproval.text();
    expect(published).toEqual(['Check this']);
  });

  it('rejects approval when finding anchor head is stale', async () => {
    const f = await fixture(); const published: string[] = [];
    const handler = handlerFor(f, 'local', published);
    await handler(request('POST', '/api/ai/review', { harnessId: 'fake' }));
    const finding = (await f.store.loadAiFindings())[0];
    if (!finding) throw new Error('finding fixture missing');
    await f.store.saveAiFindings([{ ...finding, anchorCommit: f.base }]);
    const response = await handler(request('POST', `/api/ai/findings/${finding.id}/approve`));
    expect(response.status).toBe(409);
    expect(f.store.state.drafts).toEqual([]);
    expect(published).toEqual([]);
  });

  it('rejects a harness id absent from configured harnesses before invoking it', async () => {
    const f = await fixture(); const runner: AiRunner = { ...f.runner, run: async () => { throw new Error('must not run'); } };
    const response = await aiEndpoint(request('POST', '/api/ai/chat', { harnessId: 'missing', message: 'hi' }), '/api/ai/chat', { adapter: runner, store: f.store, git: f.git, meta: f.meta, base: f.base });
    expect(response?.status).toBe(400);
  });

  it('rejects malformed and out-of-diff AI finding anchors', async () => {
    expect(() => parseFindings('{broken')).toThrow();
    const f = await fixture(); const bad: AiRunner = { ...f.runner, run: async () => '{"findings":[{"path":"a.ts","line":900,"side":"new","body":"bad","severity":"error"}],"lookouts":[]}' };
    const response = await aiEndpoint(request('POST', '/api/ai/review', { harnessId: 'fake' }), '/api/ai/review', { adapter: bad, store: f.store, git: f.git, meta: f.meta, base: f.base });
    expect((await response?.json() as { findings: unknown[] }).findings).toEqual([]);
  });

  it('anchors findings and look-outs to removed lines of a deleted file', async () => {
    const f = await fixture();
    const prompts: string[] = [];
    const runner: AiRunner = { ...f.runner, run: async (_id, prompt) => {
      if (prompt.includes('{"finding":')) { prompts.push(prompt); return 'Better wording'; }
      return JSON.stringify({ findings: [{ path: 'removed.ts', line: 1, side: 'old', body: 'Check deletion', severity: 'warning' }, { path: 'a.ts', line: 1, side: 'old', body: 'Check old value', severity: 'warning' }], lookouts: [{ path: 'removed.ts', line: 1, side: 'old', body: 'Review consumers' }] });
    } };
    const deps = { adapter: runner, store: f.store, git: f.git, meta: f.meta, base: f.base };
    const response = await aiEndpoint(request('POST', '/api/ai/review', { harnessId: 'fake' }), '/api/ai/review', deps);
    const result = await response?.json() as { findings: { id: string; path: string }[]; lookouts: { path: string }[] };
    expect(result.findings.map(finding => finding.path)).toEqual(['removed.ts', 'a.ts']);
    expect(result.lookouts.map(lookout => lookout.path)).toEqual(['removed.ts']);
    for (const finding of result.findings) {
      const reword = await aiEndpoint(request('POST', `/api/ai/findings/${finding.id}/reword`, { harnessId: 'fake' }), `/api/ai/findings/${finding.id}/reword`, deps);
      expect(reword?.status).toBe(200);
    }
    expect(prompts[0]).toContain('const obsolete = true;');
    expect(prompts[1]).toContain('const before = 1;');
    expect(prompts[1]).not.toContain('const before = 2;');
  });

  it('uses the old path for questions and rewording while rendering renamed-file findings at the new path', async () => {
    const f = await fixture();
    expect((await f.git.diffFile(f.base, f.head, 'new-name.ts', 3))?.hunks.flatMap(hunk => hunk.lines).some(line => line.kind === 'del')).toBe(true);
    const prompts: string[] = [];
    const runner: AiRunner = { ...f.runner, run: async (_id, prompt) => {
      prompts.push(prompt);
      if (prompt.includes('{"finding":')) return 'Clearer wording';
      if (prompt.includes('\n\nConversation:\n')) return 'Old-side answer';
      return JSON.stringify({ findings: [{ path: 'old-name.ts', line: 1, side: 'old', body: 'Old-side concern', severity: 'warning' }], lookouts: [{ path: 'old-name.ts', line: 1, side: 'old', body: 'Review rename' }] });
    } };
    const deps = { adapter: runner, store: f.store, git: f.git, meta: f.meta, base: f.base };
    const question = await aiEndpoint(request('POST', '/api/ai/chat', { harnessId: 'fake', message: 'Why change this?', path: 'new-name.ts', side: 'old', line: 1 }), '/api/ai/chat', deps);
    expect(question?.status).toBe(200);
    expect(prompts[0]).toContain('const value = 1;');
    const review = await aiEndpoint(request('POST', '/api/ai/review', { harnessId: 'fake' }), '/api/ai/review', deps);
    const result = await review?.json() as { findings: { id: string; path: string }[]; lookouts: { path: string }[] };
    expect(result.findings.map(finding => finding.path)).toEqual(['new-name.ts']);
    expect(result.lookouts.map(lookout => lookout.path)).toEqual(['new-name.ts']);
    const finding = result.findings[0];
    if (!finding) throw new Error('renamed finding missing');
    const reword = await aiEndpoint(request('POST', `/api/ai/findings/${finding.id}/reword`, { harnessId: 'fake' }), `/api/ai/findings/${finding.id}/reword`, deps);
    expect(reword?.status).toBe(200);
    expect(prompts[2]).toContain('const value = 1;');
  });

  it('normalizes Claude text and Codex/OpenCode JSONL events into content', () => {
    expect(parseHarnessOutput('claude', ' answer \n')).toBe('answer');
    expect(parseHarnessOutput('codex', '{"type":"item.completed","item":{"type":"agent_message","text":"codex answer"}}\n')).toBe('codex answer');
    expect(parseHarnessOutput('opencode', '{"type":"text","part":{"type":"text","text":"open answer"}}\n')).toBe('open answer');
    expect(() => parseHarnessOutput('codex', '{malformed json}\n')).toThrow();
    expect(parseHarnessOutput('codex', '{"type":"item.completed","item":{"type":"command_execution","text":"do not surface"}}\n')).toBe('');
  });

  it('extracts a review object when an agent wraps JSON in a progress note or code fence', () => {
    const review = '{"findings":[{"path":"a.ts","line":2,"side":"new","body":"Check this","severity":"warning"}],"lookouts":[]}';
    expect(parseReviewResult(`I checked the diff.\n\n${review}`).findings).toHaveLength(1);
    expect(parseReviewResult(`I checked the diff.\n\n\`\`\`json\n${review}\n\`\`\``).findings).toHaveLength(1);
    expect(() => parseReviewResult('I checked the diff and found a problem.')).toThrow('AI review');
  });

  it('uses the final review when a progress note contains an earlier example object', () => {
    const final = '{"findings":[{"path":"a.ts","line":2,"side":"new","body":"Real finding","severity":"warning"}],"lookouts":[]}';
    expect(parseReviewResult(`Example: {"findings":[],"lookouts":[]}\nFinal: ${final}`).findings[0]?.body).toBe('Real finding');
  });
});
