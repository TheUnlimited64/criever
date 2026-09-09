import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Git } from '../src/git';
import { LocalReviewStore } from '../src/localreview';
import { LocalProvider } from '../src/providers/local';
import { buildThreads } from '../src/threads';
import { startup } from '../src/startup';

let dir: string; let git: Git; let base = ''; let head = '';
const sh = async (cwd: string, args: string[]) => {
  const p = Bun.spawn(['git', ...args], { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, stdout: 'pipe', stderr: 'pipe' });
  await p.exited; return (await new Response(p.stdout).text()).trim();
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'criever-localprovider-'));
  await sh(dir, ['init', '-q', '-b', 'main']);
  writeFileSync(join(dir, 'a.ts'), 'line1\nline2\nline3\n');
  await sh(dir, ['add', '.']); await sh(dir, ['commit', '-qm', 'base']);
  base = await sh(dir, ['rev-parse', 'HEAD']);
  await sh(dir, ['checkout', '-qb', 'feat']);
  writeFileSync(join(dir, 'a.ts'), 'line1\nline2 changed\nline3\n');
  await sh(dir, ['commit', '-qam', 'feat']);
  head = await sh(dir, ['rev-parse', 'HEAD']);
  git = new Git(dir);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('LocalProvider', () => {
  it('meta() reports base/head/branch and a null url', async () => {
    const store = new LocalReviewStore(LocalReviewStore.path(dir)); await store.load();
    const provider = new LocalProvider(git, store, base, head, 'feat');
    const meta = await provider.meta();
    expect(meta.url).toBeNull();
    expect(meta.sourceBranch).toBe('feat');
    expect(meta.destinationBranch).toBe(base);
    expect(meta.sourceHead).toBe(head);
    expect(meta.destinationHead).toBe(base);
    expect(meta.title).toBe(`local review · ${base.slice(0, 7)}..${head.slice(0, 7)}`);
  });

  it('listCommits() matches the commits in the range', async () => {
    const store = new LocalReviewStore(LocalReviewStore.path(dir)); await store.load();
    const provider = new LocalProvider(git, store, base, head, 'feat');
    const commits = await provider.listCommits();
    expect(commits.map(c => c.hash)).toEqual([head]);
    expect(commits[0]!.message).toBe('feat');
  });

  it('publishComment appends through the store; listComments maps authors and nests replies', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'criever-localprovider-'));
    const store = new LocalReviewStore(LocalReviewStore.path(tmp)); await store.load();
    const provider = new LocalProvider(git, store, base, head, 'feat');

    const rootId = await provider.publishComment({ raw: 'looks off', path: 'a.ts', line: 2, side: 'new' });
    await store.add({ path: null, line: null, side: 'new', body: 'agent note', author: 'agent', agentName: 'coding-agent', anchorCommit: head });

    const comments = await provider.listComments();
    const root = comments.find(c => c.id === rootId)!;
    expect(root.author).toEqual({ name: 'you', initials: 'ME', isMe: true });
    expect(root.inline).toEqual({ path: 'a.ts', from: null, to: 2 });
    expect(root.resolved).toBe(false);

    const agentComment = comments.find(c => c.author.name === 'coding-agent')!;
    // single hyphenated "word" → the shared initials algorithm (also used for Bitbucket authors) takes one letter
    expect(agentComment.author).toEqual({ name: 'coding-agent', initials: 'C', isMe: false });

    const replyId = await provider.publishComment({ raw: 'fixed', path: 'a.ts', line: 2, side: 'new', parentId: rootId });
    const withReply = await provider.listComments();
    const reply = withReply.find(c => c.id === replyId)!;
    expect(reply.parentId).toBe(rootId);

    rmSync(tmp, { recursive: true, force: true });
  });

  it('resolveComment flips the flag through the store', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'criever-localprovider-'));
    const store = new LocalReviewStore(LocalReviewStore.path(tmp)); await store.load();
    const provider = new LocalProvider(git, store, base, head, 'feat');
    const id = await provider.publishComment({ raw: 'x', path: 'a.ts', line: 1, side: 'new' });
    expect((await provider.listComments()).find(c => c.id === id)!.resolved).toBe(false);
    await provider.resolveComment(id);
    expect((await provider.listComments()).find(c => c.id === id)!.resolved).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('re-anchors a comment across a commit that moves its line (changed/moved status)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'criever-reanchor-'));
    await sh(tmp, ['init', '-q', '-b', 'main']);
    writeFileSync(join(tmp, 'f.ts'), 'a\nb\nc\nd\n');
    await sh(tmp, ['add', '.']); await sh(tmp, ['commit', '-qm', 'base']);
    const b = await sh(tmp, ['rev-parse', 'HEAD']);

    const localGit = new Git(tmp);
    const store = new LocalReviewStore(LocalReviewStore.path(tmp)); await store.load();
    const provider = new LocalProvider(localGit, store, b, 'HEAD', 'main');

    // comment on line 3 ('c') at the current head
    const commentId = await provider.publishComment({ raw: 'about c', path: 'f.ts', line: 3, side: 'new' });

    // insert two lines above it, so 'c' moves from line 3 to line 5
    writeFileSync(join(tmp, 'f.ts'), 'a\nx\ny\nb\nc\nd\n');
    await sh(tmp, ['commit', '-qam', 'insert above']);
    const newHead = await sh(tmp, ['rev-parse', 'HEAD']);

    const comments = await provider.listComments();
    const commits = await provider.listCommits(); // required by buildThreads' signature, unused otherwise here

    const hunksFor = async (anchorCommit: string, path: string) => {
      const f = await localGit.diffFile(anchorCommit, newHead, path, 0);
      if (f?.status === 'D') return 'fileDeleted' as const;
      if (!f) return { hunks: [], newPath: null };
      return { hunks: f.hunks, newPath: f.status === 'R' ? f.newPath : null };
    };

    // LocalProvider doesn't carry Anchor objects itself (that's the state store's job in the
    // server); reconstruct the one thread's anchor the same way server.ts's /api/comments does —
    // from the comment's own inline position plus the anchorCommit it was published against.
    const root = comments.find(c => c.id === commentId)!;
    const commentAnchorCommit = b; // publishComment resolves `head` (HEAD at publish time) as the anchorCommit
    const preAnchors = { [root.id]: { path: 'f.ts', line: 3, side: 'new' as const, anchorCommit: commentAnchorCommit, source: 'criever' as const } };

    const { threads } = await buildThreads(comments, preAnchors, commits, hunksFor);
    const thread = threads.find(t => t.root.id === commentId)!;
    // a pure insertion above the commented line shifts it without touching it directly: 'moved', not 'changed'
    expect(thread.status).toMatchObject({ status: 'moved', newLine: 5 });
    expect(thread.displayLine).toBe(5);

    rmSync(tmp, { recursive: true, force: true });
  });

  it('startup() in local mode works end to end inside a repo with no remote at all', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'criever-nolremote-'));
    await sh(tmp, ['init', '-q', '-b', 'main']);
    writeFileSync(join(tmp, 'x.ts'), '1\n2\n');
    await sh(tmp, ['add', '.']); await sh(tmp, ['commit', '-qm', 'base']);
    const b = await sh(tmp, ['rev-parse', 'HEAD']);
    await sh(tmp, ['checkout', '-qb', 'feat']);
    writeFileSync(join(tmp, 'x.ts'), '1\n2x\n');
    await sh(tmp, ['commit', '-qam', 'feat']);

    const stateDir = mkdtempSync(join(tmpdir(), 'criever-state-'));
    const log: string[] = [];
    const deps = await startup({ cwd: tmp, env: { CRIEVER_STATE_DIR: stateDir }, local: true, base: 'main', log: s => log.push(s) });
    expect(deps.provider.kind).toBe('local');
    expect(deps.meta.url).toBeNull();
    expect(deps.mergeBase).toBe(b);
    expect(deps.ws).toBe('local');
    expect(existsSync(LocalReviewStore.path(tmp))).toBe(true);

    rmSync(tmp, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });
});
