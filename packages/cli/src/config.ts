import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { UserError } from './errors';

type Env = Record<string, string | undefined>;
export type HarnessKind = 'claude' | 'codex' | 'opencode';
export interface Harness { readonly id: string; readonly name: string; readonly kind: HarnessKind; readonly executable?: string }

export function defaultPaths(env: Env) {
  const home = homedir();
  return {
    configPath: join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'criever', 'config.json'),
    stateDir: env.CRIEVER_STATE_DIR ?? join(home, '.local/share/criever'),
    cacheDir: env.CRIEVER_CACHE_DIR ?? join(home, '.cache/criever'),
  };
}

export async function loadCredentials(env: Env, configPath: string): Promise<{ email: string; token: string }> {
  if (env.ATLASSIAN_USER_EMAIL && env.ATLASSIAN_API_TOKEN) return { email: env.ATLASSIAN_USER_EMAIL, token: env.ATLASSIAN_API_TOKEN };
  try {
    const j = JSON.parse(await readFile(configPath, 'utf8'));
    if (typeof j.email === 'string' && typeof j.token === 'string') return { email: j.email, token: j.token };
  } catch { /* fall through */ }
  throw new UserError(`No Bitbucket credentials.\nProvide ATLASSIAN_USER_EMAIL and ATLASSIAN_API_TOKEN, or configure ${configPath}.`);
}

export async function loadHarnesses(configPath: string): Promise<readonly Harness[]> {
  let raw: string;
  try { raw = await readFile(configPath, 'utf8'); } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return [];
    throw e;
  }
  const value: unknown = JSON.parse(raw);
  if (typeof value !== 'object' || value === null || !('harnesses' in value) || !Array.isArray(value.harnesses)) return [];
  return value.harnesses.flatMap((item: unknown): Harness[] => {
    if (typeof item !== 'object' || item === null) return [];
    const candidate = item as Record<string, unknown>;
    const { id, name, kind, executable } = candidate;
    if (typeof id !== 'string' || !id || typeof name !== 'string' || !name || !['claude', 'codex', 'opencode'].includes(String(kind))) return [];
    if (executable !== undefined && (typeof executable !== 'string' || executable.length === 0)) return [];
    return [{ id, name, kind: kind as HarnessKind, ...(typeof executable === 'string' ? { executable } : {}) }];
  });
}
