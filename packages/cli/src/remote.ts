import { UserError } from './errors';

const RE = /bitbucket\.org[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/;

export function parseRemote(url: string): { workspace: string; repo: string } {
  const m = RE.exec(url.trim());
  if (!m) throw new UserError(`Not a bitbucket.org remote: ${url}\nOnly Bitbucket Cloud is supported.`);
  return { workspace: m[1]!, repo: m[2]! };
}
