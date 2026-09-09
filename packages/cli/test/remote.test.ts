import { describe, it, expect } from 'vitest';
import { parseRemote } from '../src/remote';
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
});
