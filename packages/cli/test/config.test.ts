import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { loadCredentials, defaultPaths } from '../src/config';

describe('loadCredentials', () => {
  it('prefers env', async () => {
    expect(await loadCredentials({ ATLASSIAN_USER_EMAIL: 'a@b', ATLASSIAN_API_TOKEN: 't' }, '/nonexistent')).toEqual({ email: 'a@b', token: 't' });
  });
  it('falls back to config file', async () => {
    const p = join(mkdtempSync(join(tmpdir(), 'cfg-')), 'config.json');
    writeFileSync(p, JSON.stringify({ email: 'c@d', token: 'x' }));
    expect(await loadCredentials({}, p)).toEqual({ email: 'c@d', token: 'x' });
  });
  it('throws UserError naming env vars and config path', async () => {
    await expect(loadCredentials({}, '/no/such/config.json')).rejects.toThrow(/ATLASSIAN_API_TOKEN.*ATLASSIAN_USER_EMAIL|ATLASSIAN_USER_EMAIL.*ATLASSIAN_API_TOKEN/s);
    await expect(loadCredentials({}, '/no/such/config.json')).rejects.toThrow(/\/no\/such\/config\.json/);
  });
});
describe('defaultPaths', () => {
  it('defaults under home', () => {
    const p = defaultPaths({});
    expect(p.configPath).toBe(join(homedir(), '.config/criever/config.json'));
    expect(p.stateDir).toBe(join(homedir(), '.local/share/criever'));
    expect(p.cacheDir).toBe(join(homedir(), '.cache/criever'));
  });
  it('honours overrides', () => {
    const p = defaultPaths({ CRIEVER_STATE_DIR: '/s', CRIEVER_CACHE_DIR: '/c', XDG_CONFIG_HOME: '/x' });
    expect(p).toEqual({ configPath: '/x/criever/config.json', stateDir: '/s', cacheDir: '/c' });
  });
});
