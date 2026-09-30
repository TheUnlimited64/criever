import { UserError } from './errors';

const RE = /(?:^|[\/@])(bitbucket\.org|github\.com)[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/;

export function remoteProvider(url: string): 'bitbucket' | 'github' {
  const m = RE.exec(url.trim());
  if (!m) throw new UserError(`Not a supported remote: ${url}\nBitbucket Cloud and GitHub.com are supported.`);
  return m[1] === 'github.com' ? 'github' : 'bitbucket';
}

export function parseRemote(url: string): { workspace: string; repo: string } {
  const m = RE.exec(url.trim());
  if (!m) throw new UserError(`Not a supported remote: ${url}\nBitbucket Cloud and GitHub.com are supported.`);
  return { workspace: m[2]!, repo: m[3]! };
}
