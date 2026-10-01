import { readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { WorkspaceFolders } from '@criever/shared';
import { DaemonError } from './errors';

type Locations = { readonly home: string; readonly cwd: string };

export function resolveProjectPath(input: string, locations: Locations): string {
  const path = input.trim();
  if (path === '~') return resolve(locations.home);
  if (path.startsWith('~/') || (sep === '\\' && path.startsWith('~\\'))) return resolve(join(locations.home, path.slice(2)));
  return resolve(locations.cwd, path);
}

export async function listProjectFolders(input: string, locations: Locations): Promise<WorkspaceFolders> {
  const requested = resolveProjectPath(input || '~', locations);
  try {
    const path = await realpath(requested);
    const entries = await readdir(path, { withFileTypes: true });
    const folders = await Promise.all(entries.map(async entry => {
      const child = join(path, entry.name);
      let directory = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        try { directory = (await stat(child)).isDirectory(); }
        catch (error) {
          if (!(error instanceof Error && 'code' in error && ['ENOENT', 'EACCES', 'EPERM', 'ELOOP'].includes(String(error.code)))) throw error;
        }
      }
      return directory ? { name: entry.name, path: child } : null;
    }));
    return {
      path, parentPath: dirname(path) === path ? null : dirname(path), homePath: resolve(locations.home), separator: sep,
      folders: folders.filter(folder => folder !== null).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    };
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      if (error.code === 'EACCES' || error.code === 'EPERM') throw new DaemonError(`Permission denied opening folder: ${requested}`, 403);
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new DaemonError(`Folder not found: ${requested}`, 404);
    }
    throw error;
  }
}

export async function suggestProjectFolders(input: string, locations: Locations): Promise<WorkspaceFolders> {
  const value = input.trim();
  if (!value || value === '~' || value.endsWith('/') || value.endsWith(sep)) return listProjectFolders(value || '~', locations);
  const path = resolveProjectPath(value, locations);
  const listing = await listProjectFolders(dirname(path), locations);
  const prefix = basename(path).toLocaleLowerCase();
  return { ...listing, folders: listing.folders.filter(folder => folder.name.toLocaleLowerCase().startsWith(prefix)) };
}
