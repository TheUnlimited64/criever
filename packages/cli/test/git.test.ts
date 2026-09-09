import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Git } from '../src/git';
import { UserError } from '../src/errors';

let dir: string; let git: Git; let base = ''; let head = '';
const sh = async (args: string[]) => {
  const p = Bun.spawn(['git', ...args], { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, stdout: 'pipe', stderr: 'pipe' });
  await p.exited; return (await new Response(p.stdout).text()).trim();
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'criever-git-'));
  await sh(['init', '-q', '-b', 'main']);
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/a.ts'), 'line1\nline2\nline3\n');
  writeFileSync(join(dir, 'src/old.ts'), 'keep\n');
  await sh(['add', '.']); await sh(['commit', '-qm', 'base']);
  base = await sh(['rev-parse', 'HEAD']);
  await sh(['checkout', '-qb', 'feat']);
  writeFileSync(join(dir, 'src/a.ts'), 'line1\nline2 changed\nline3\nline4\n');
  await sh(['mv', 'src/old.ts', 'src/new.ts']);
  writeFileSync(join(dir, 'src/added.ts'), 'hello grep\n');
  await sh(['add', '-A']); await sh(['commit', '-qm', 'feat']);
  head = await sh(['rev-parse', 'HEAD']);
  await sh(['remote', 'add', 'origin', 'git@bitbucket.org:ws/repo.git']);
  git = await Git.open(join(dir, 'src'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('Git', () => {
  it('open resolves the repo root from a subdirectory', () => expect(git.root).toBe(dir));
  it('remoteUrl', async () => expect(await git.remoteUrl()).toBe('git@bitbucket.org:ws/repo.git'));
  it('currentBranch', async () => expect(await git.currentBranch()).toBe('feat'));
  it('currentBranch throws UserError on detached HEAD', async () => {
    await sh(['checkout', '-q', head]);
    await expect(git.currentBranch()).rejects.toThrow(UserError);
    await sh(['checkout', '-q', 'feat']);
  });
  it('mergeBase', async () => expect(await git.mergeBase('main', 'feat')).toBe(base));
  it('changedFiles lists A/M/R with counts', async () => {
    const files = await git.changedFiles(base, head);
    const byPath = Object.fromEntries(files.map(f => [f.newPath ?? f.oldPath, f]));
    expect(byPath['src/a.ts']).toMatchObject({ status: 'M', additions: 2, deletions: 1 });
    expect(byPath['src/added.ts']).toMatchObject({ status: 'A', additions: 1 });
    expect(byPath['src/new.ts']).toMatchObject({ status: 'R', oldPath: 'src/old.ts' });
  });
  it('diffFile with context 0 returns hunks', async () => {
    const f = await git.diffFile(base, head, 'src/a.ts', 0);
    expect(f!.hunks.map(h => [h.oldStart, h.oldLen, h.newStart, h.newLen])).toEqual([[2, 1, 2, 1], [3, 0, 4, 1]]);
  });
  it('diffFile returns null for an unchanged path', async () => expect(await git.diffFile(base, head, 'nope.ts', 3)).toBeNull());
  it('show returns content or null', async () => {
    expect(await git.show(base, 'src/a.ts')).toBe('line1\nline2\nline3\n');
    expect(await git.show(base, 'src/added.ts')).toBeNull();
  });
  it('lsTree lists all paths', async () => expect(await git.lsTree(head)).toEqual(['src/a.ts', 'src/added.ts', 'src/new.ts']));
  it('grep finds hits with line numbers', async () =>
    expect(await git.grep(head, 'hello')).toEqual([{ path: 'src/added.ts', line: 1, text: 'hello grep' }]));
  it('grep returns [] on no match', async () => expect(await git.grep(head, 'zzzz')).toEqual([]));
  it('revListCount', async () => {
    expect(await git.revListCount(base, head)).toBe(1);
    expect(await git.revListCount(head, head)).toBe(0);
  });
  it('isUnchanged', async () => {
    expect(await git.isUnchanged(base, head, 'src/a.ts')).toBe(false);
    expect(await git.isUnchanged(head, head, 'src/a.ts')).toBe(true);
  });
  it('fetch failure throws UserError containing git stderr', async () => {
    await expect(git.fetch('origin', ['main'])).rejects.toThrow(UserError);
  });
});

describe('resolveRemote', () => {
  const mkRepo = async (remotes: [string, string][]) => {
    const d = mkdtempSync(join(tmpdir(), 'criever-remote-'));
    const run = async (args: string[]) => { const p = Bun.spawn(['git', ...args], { cwd: d, stdout: 'pipe', stderr: 'pipe' }); await p.exited; };
    await run(['init', '-q']);
    for (const [name, url] of remotes) await run(['remote', 'add', name, url]);
    return { git: new Git(d), dispose: () => rmSync(d, { recursive: true, force: true }) };
  };

  it('uses the only remote when it is not named origin', async () => {
    const { git, dispose } = await mkRepo([['bitbucket', 'git@bitbucket.org:ws/repo.git']]);
    await expect(git.resolveRemote()).resolves.toEqual({ name: 'bitbucket', url: 'git@bitbucket.org:ws/repo.git' });
    dispose();
  });

  it('prefers origin when both origin and another remote exist', async () => {
    const { git, dispose } = await mkRepo([['bitbucket', 'git@bitbucket.org:ws/other.git'], ['origin', 'git@bitbucket.org:ws/repo.git']]);
    await expect(git.resolveRemote()).resolves.toEqual({ name: 'origin', url: 'git@bitbucket.org:ws/repo.git' });
    dispose();
  });

  it('rejects with UserError when there are no remotes', async () => {
    const { git, dispose } = await mkRepo([]);
    await expect(git.resolveRemote()).rejects.toThrow(UserError);
    dispose();
  });

  it('rejects with UserError naming both remotes when neither is origin', async () => {
    const { git, dispose } = await mkRepo([['bitbucket', 'git@bitbucket.org:ws/a.git'], ['upstream', 'git@bitbucket.org:ws/b.git']]);
    await expect(git.resolveRemote()).rejects.toThrow(/bitbucket, upstream/);
    dispose();
  });
});
