import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { UserError } from './errors';

type Env = Record<string, string | undefined>;

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

export async function loadGithubCredentials(env: Env, configPath: string): Promise<{ token: string }> {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (token) return { token };
  try {
    const j = JSON.parse(await readFile(configPath, 'utf8'));
    if (typeof j.github?.token === 'string' && j.github.token) return { token: j.github.token };
  } catch { /* fall through, like Bitbucket configuration */ }
  throw new UserError(`No GitHub credentials.\nProvide GITHUB_TOKEN or GH_TOKEN, or configure github.token in ${configPath}.`);
}
