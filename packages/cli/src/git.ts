import type { FileDiff } from '@criever/shared';
import { parseUnifiedDiff } from './diff';
import { UserError } from './errors';

export class Git {
  constructor(public readonly root: string) {}

  static async open(cwd: string): Promise<Git> {
    const p = Bun.spawn(['git', 'rev-parse', '--show-toplevel'], { cwd, stdout: 'pipe', stderr: 'pipe' });
    const out = (await new Response(p.stdout).text()).trim();
    if ((await p.exited) !== 0) throw new UserError(`Not a git repository: ${cwd}\nRun criever inside the repo you want to review.`);
    return new Git(out);
  }

  async run(args: string[], opts: { allowFail?: boolean } = {}) {
    const p = Bun.spawn(['git', '--no-pager', ...args], {
      cwd: this.root, stdout: 'pipe', stderr: 'pipe',
      env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
    });
    const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    if (code !== 0 && !opts.allowFail) throw new Error(`git ${args.join(' ')} failed (${code}):\n${stderr.trim()}`);
    return { stdout, stderr, code };
  }

  async remoteUrl(name = 'origin'): Promise<string> {
    const r = await this.run(['remote', 'get-url', name], { allowFail: true });
    if (r.code !== 0) throw new UserError(`No remote "${name}" in ${this.root}.\nAdd it with: git remote add ${name} <url>`);
    return r.stdout.trim();
  }

  /** The remote criever reviews against: `origin` when present, otherwise the only remote. */
  async resolveRemote(): Promise<{ name: string; url: string }> {
    const names = (await this.run(['remote'])).stdout.split('\n').filter(Boolean);
    if (names.length === 0) throw new UserError(`No git remotes in ${this.root}.\nAdd one with: git remote add origin git@bitbucket.org:<workspace>/<repo>.git`);
    const name = names.includes('origin') ? 'origin' : names.length === 1 ? names[0]! : null;
    if (!name) throw new UserError(`No remote named "origin" in ${this.root} (remotes: ${names.join(', ')}).\nRename the Bitbucket one with: git remote rename <name> origin`);
    return { name, url: await this.remoteUrl(name) };
  }

  async currentBranch(): Promise<string> {
    const b = (await this.run(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    if (b === 'HEAD') throw new UserError('HEAD is detached. Check out the PR branch first: git checkout <branch>');
    return b;
  }

  async fetch(remote: string, refs: string[]): Promise<void> {
    const r = await this.run(['fetch', '--no-tags', remote, ...refs], { allowFail: true });
    if (r.code !== 0) throw new UserError(`git fetch ${remote} ${refs.join(' ')} failed:\n${r.stderr.trim()}`);
  }

  async mergeBase(a: string, b: string): Promise<string> {
    return (await this.run(['merge-base', a, b])).stdout.trim();
  }

  async changedFiles(base: string, head: string): Promise<FileDiff[]> {
    // Full diff parsed once for counts + statuses; fine up to tens of MB. Switch to --numstat if it ever hurts.
    const r = await this.run(['diff', '-M', '--no-color', '--no-ext-diff', '-U0', base, head]);
    return parseUnifiedDiff(r.stdout).map(f => ({ ...f, hunks: [] }));
  }

  async diffFile(base: string, head: string, path: string, context: number): Promise<FileDiff | null> {
    const r = await this.run(['diff', '-M', '--no-color', '--no-ext-diff', `-U${context}`, base, head, '--', path]);
    return parseUnifiedDiff(r.stdout)[0] ?? null;
  }

  async show(commit: string, path: string): Promise<string | null> {
    const r = await this.run(['show', `${commit}:${path}`], { allowFail: true });
    return r.code === 0 ? r.stdout : null;
  }

  async lsTree(commit: string): Promise<string[]> {
    const r = await this.run(['ls-tree', '-r', '--name-only', commit]);
    return r.stdout.split('\n').filter(Boolean);
  }

  async grep(commit: string, query: string, max = 500) {
    const r = await this.run(['grep', '-n', '-I', '--no-color', '-e', query, commit], { allowFail: true });
    if (r.code === 1) return [];
    if (r.code !== 0) throw new Error(r.stderr);
    const out: { path: string; line: number; text: string }[] = [];
    for (const l of r.stdout.split('\n')) {
      if (out.length >= max) break;
      const m = /^[^:]+:([^:]+):(\d+):(.*)$/.exec(l); // "<commit>:<path>:<line>:<text>"
      if (m) out.push({ path: m[1]!, line: +m[2]!, text: m[3]! });
    }
    return out;
  }

  async revListCount(from: string, to: string): Promise<number> {
    return +(await this.run(['rev-list', '--count', `${from}..${to}`])).stdout.trim();
  }

  async isUnchanged(a: string, b: string, path: string): Promise<boolean> {
    const r = await this.run(['diff', '--quiet', '-M', a, b, '--', path], { allowFail: true });
    return r.code === 0;
  }
}
