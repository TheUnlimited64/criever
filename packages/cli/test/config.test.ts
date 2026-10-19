import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { loadCredentials, loadGithubCredentials, defaultPaths } from '../src/config';

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
describe('loadGithubCredentials', () => {
  it('prefers GITHUB_TOKEN over GH_TOKEN and configuration', async () => {
    expect(await loadGithubCredentials({ GITHUB_TOKEN: 'first', GH_TOKEN: 'second' }, '/nonexistent')).toEqual({ token: 'first' });
    expect(await loadGithubCredentials({ GH_TOKEN: 'second' }, '/nonexistent')).toEqual({ token: 'second' });
  });
  it('reads GitHub credentials separately from Bitbucket', async () => {
    const p = join(mkdtempSync(join(tmpdir(), 'cfg-')), 'config.json');
    writeFileSync(p, JSON.stringify({ email: 'c@d', token: 'bb', github: { token: 'gh' } }));
    expect(await loadGithubCredentials({}, p)).toEqual({ token: 'gh' });
    expect(await loadCredentials({}, p)).toEqual({ email: 'c@d', token: 'bb' });
  });
  it('rejects missing and empty credentials', async () => {
    await expect(loadGithubCredentials({}, '/nonexistent')).rejects.toThrow(/GITHUB_TOKEN/);
    await expect(loadGithubCredentials({ GITHUB_TOKEN: '' }, '/nonexistent')).rejects.toThrow(/github.token/);
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
