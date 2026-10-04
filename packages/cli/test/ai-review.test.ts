import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFixtureRepo } from '../fixtures/repo';
import { startup } from '../src/startup';
import { createHandler } from '../src/server';
import { StateStore } from '../src/state';

describe('private AI review boundary', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'criever-ai-'));
  let base: Awaited<ReturnType<typeof startup>>;
  let path: string;
  let calls: string[];

  beforeAll(async () => {
    const repo = await buildFixtureRepo(join(tmp, 'repo'));
    base = await startup({ cwd: repo.root, env: { CRIEVER_STATE_DIR: join(tmp, 'state') }, local: true, base: repo.main, head: repo.c3, log: () => {} });
    path = 'src/devices/DeviceList.tsx';
    calls = [];
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  const open = (kind: 'local' | 'bitbucket' = 'local') => {
    const published: string[] = [];
    const deps = {
      ...base, provider: {
        ...base.provider, kind,
        listComments: () => base.provider.listComments(),
        publishComment: async (input: { raw: string }) => { published.push(input.raw); return published.length; },
      },
      ai: {
        harnesses: [{ id: 'assistant', kind: 'codex', name: 'Test assistant' }],
        run: async (_harness: unknown, prompt: string) => {
          calls.push(prompt);
          if (prompt.includes('JSON')) return JSON.stringify({ findings: [{ path, line: 13, side: 'new', body: 'Check the row index' }], lookouts: [{ path, line: 11, side: 'new', body: 'Inspect the row lifecycle' }] });
          return 'The row uses its index to look up a device.';
        },
      },
      staticDir: null, vscode: null,
    };
    const handler = createHandler(deps);
    const request = (method: string, route: string, data?: object) => handler(new Request(`http://localhost${route}`, { method, headers: { 'content-type': 'application/json' }, body: data ? JSON.stringify(data) : undefined }));
    return { request, published };
  };

  it.each(['local', 'bitbucket'] as const)('keeps line Q&A and guidance private in %s mode', async mode => {
    const { request, published } = open(mode);
    expect((await request('GET', '/api/ai')).status).toBe(200);
    const answer = await request('POST', '/api/ai/questions', { harnessId: 'assistant', path, line: 13, side: 'new', question: 'What does this row do?' });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ question: 'What does this row do?', reply: 'The row uses its index to look up a device.' });
    expect(calls.at(-1)).toContain('What does this row do?');
    expect(calls.at(-1)).toContain('rows.map');
    const review = await request('POST', '/api/ai/review', { harnessId: 'assistant' });
    expect(review.status).toBe(200);
    const state = await (await request('GET', '/api/ai')).json();
    expect(state.questions).toHaveLength(1);
    expect(state.lookouts).toMatchObject([{ line: 11 }]);
    expect(state.findings).toMatchObject([{ line: 13, body: 'Check the row index' }]);
    expect((await (await request('GET', '/api/comments')).json()).drafts).toHaveLength(0);
    await (await request('POST', '/api/publish')).text();
    expect(published).toHaveLength(0);

    const loaded = new StateStore(base.store.file); await loaded.load();
    expect(loaded.state.ai?.questions).toHaveLength(1);
    expect(loaded.state.ai?.findings).toHaveLength(1);
  });

  it('only approval creates a publishable, editable draft', async () => {
    const { request, published } = open('bitbucket');
    const result = await (await request('POST', '/api/ai/review', { harnessId: 'assistant' })).json();
    const id = result.findings.at(-1).id;
    expect((await request('PATCH', `/api/ai/findings/${id}`, { body: 'Reviewer wording' })).status).toBe(200);
    const approved = await request('POST', `/api/ai/findings/${id}/approve`);
    expect(approved.status).toBe(200);
    expect((await (await request('GET', '/api/comments')).json()).drafts).toContainEqual(expect.objectContaining({ body: 'Reviewer wording' }));
    await (await request('POST', '/api/publish')).text();
    expect(published).toContain('Reviewer wording');
    expect(published).not.toContain('Inspect the row lifecycle');
  });
});
