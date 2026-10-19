import { describe, it, expect } from 'vitest';
import { parseRemote, remoteProvider } from '../src/remote';
import { UserError } from '../src/errors';

describe('parseRemote', () => {
  it.each([
    ['git@bitbucket.org:sample-workspace/review-fixture.git', 'sample-workspace', 'review-fixture'],
    ['git@bitbucket.org:sample-workspace/review-fixture', 'sample-workspace', 'review-fixture'],
    ['https://bitbucket.org/sample-workspace/review-fixture.git', 'sample-workspace', 'review-fixture'],
    ['https://reviewer@bitbucket.org/sample-workspace/review-fixture', 'sample-workspace', 'review-fixture'],
    ['ssh://git@bitbucket.org/sample-workspace/review-fixture.git', 'sample-workspace', 'review-fixture'],
  ])('%s', (url, workspace, repo) => {
    expect(parseRemote(url)).toEqual({ workspace, repo });
  });
  it('rejects non-bitbucket remotes with a message naming the URL', () => {
    expect(() => parseRemote('git@code.example.test:sample-org/sample-repo.git')).toThrow(UserError);
    expect(() => parseRemote('git@code.example.test:sample-org/sample-repo.git')).toThrow(/git@code.example.test:sample-org\/sample-repo.git/);
  });
  it.each([
    'git@github.com:sample-org/sample-repo.git',
    'https://github.com/sample-org/sample-repo.git',
    'ssh://git@github.com/sample-org/sample-repo',
  ])('recognizes GitHub remote %s', url => {
    expect(parseRemote(url)).toEqual({ workspace: 'sample-org', repo: 'sample-repo' });
    expect(remoteProvider(url)).toBe('github');
  });
  it('does not accept a hostname suffix impersonating GitHub', () => {
    expect(() => parseRemote('https://notgithub.com/sample-org/sample-repo')).toThrow(UserError);
    expect(remoteProvider('git@bitbucket.org:ws/repo.git')).toBe('bitbucket');
  });
});
