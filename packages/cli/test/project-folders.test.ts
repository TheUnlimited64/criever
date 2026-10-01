import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { listProjectFolders, resolveProjectPath } from '../src/project-folders';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('browses directories and directory symlinks without including files or broken links', async () => {
  const home = await mkdtemp(join(tmpdir(), 'criever-folders-')); roots.push(home);
  await mkdir(join(home, 'repo with spaces'));
  await mkdir(join(home, '.hidden'));
  await writeFile(join(home, 'file.txt'), 'not a folder');
  await symlink(join(home, 'repo with spaces'), join(home, 'linked-repo'), 'junction');
  await symlink(join(home, 'missing'), join(home, 'broken-link'), 'junction');
  const folders = await listProjectFolders('~', { home, cwd: tmpdir() });
  expect(folders.path).toBe(home);
  expect(folders.parentPath).toBe(dirname(home));
  expect(folders.folders.map(folder => folder.name).sort()).toEqual(['.hidden', 'linked-repo', 'repo with spaces']);
  expect((await listProjectFolders('~/repo with spaces', { home, cwd: tmpdir() })).folders).toEqual([]);
});

it('expands only home shorthand and preserves normal relative and absolute paths', () => {
  const locations = { home: join(tmpdir(), 'home'), cwd: join(tmpdir(), 'work') };
  expect(resolveProjectPath('~', locations)).toBe(locations.home);
  expect(resolveProjectPath(' ~/project ', locations)).toBe(join(locations.home, 'project'));
  expect(resolveProjectPath('project', locations)).toBe(join(locations.cwd, 'project'));
  expect(resolveProjectPath(locations.home, locations)).toBe(locations.home);
  expect(resolveProjectPath('~someone/project', locations)).toBe(join(locations.cwd, '~someone/project'));
});

it('returns an actionable error for nonexistent folders and regular files', async () => {
  const home = await mkdtemp(join(tmpdir(), 'criever-folders-')); roots.push(home);
  await writeFile(join(home, 'file.txt'), 'not a directory');
  await expect(listProjectFolders('~/missing', { home, cwd: home })).rejects.toMatchObject({ status: 404 });
  await expect(listProjectFolders('~/file.txt', { home, cwd: home })).rejects.toMatchObject({ status: 404 });
});

it('disables parent navigation at the filesystem root', async () => {
  const root = parse(tmpdir()).root;
  expect((await listProjectFolders(root, { home: tmpdir(), cwd: tmpdir() })).parentPath).toBeNull();
});
