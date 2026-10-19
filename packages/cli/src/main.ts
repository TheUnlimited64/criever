#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { BitbucketError } from './bitbucket';
import { GitHubError } from './github';
import { runCommentsCli } from './cli-comments';
import { UserError } from './errors';
import { createHandler } from './server';
import { startup } from './startup';
import { createVscode } from './vscode';
import { createDaemon } from './daemon';

const args = process.argv.slice(2);
if (args[0] === 'comment' || args[0] === 'comments') process.exit(await runCommentsCli(args, process.cwd()));

const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const daemonMode = args[0] === 'daemon' || args.includes('--daemon');
const port = Number(flag('--port') ?? (daemonMode ? 4917 : 0));
const noOpen = args.includes('--no-open');
const dev = args.includes('--dev');
const local = args.includes('--local');
const base = flag('--base');
const head = flag('--head');

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url]
    : existsSync('/proc/sys/fs/binfmt_misc/WSLInterop') ? ['wslview', url] : ['xdg-open', url];
  try { Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' }); } catch { /* user opens manually */ }
}

try {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UserError('--port must be an integer between 0 and 65535.');
  if (daemonMode && (local || base || head)) throw new UserError('Daemon mode selects projects and pull requests in the browser; omit --local, --base and --head.');
  if (daemonMode) {
    const daemon = await createDaemon({ env: process.env, staticDir: dev ? null : 'embedded', log: s => console.error(s) });
    let server;
    try {
      server = Bun.serve({ hostname: '127.0.0.1', port, fetch: daemon.fetch });
    } catch (error) {
      await daemon.stop();
      throw error;
    }
    const url = `http://127.0.0.1:${server.port}`;
    console.error(`criever daemon ready: ${url}`);
    if (!noOpen) openBrowser(url);
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      await server.stop();
      await daemon.stop();
      process.exit(0);
    };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  } else {
    if ((base || head) && !local) throw new UserError('--base/--head require --local.\nAdd --local, or drop --base/--head for a PR review.');
    const deps = await startup({ cwd: process.cwd(), env: process.env, log: s => console.error(s), local, base, head });
    const staticDir = dev ? null : 'embedded';
    const vscode = createVscode({ repoRoot: deps.git.root, cacheDir: (await import('./config')).defaultPaths(process.env).cacheDir, log: s => console.error(s) });
    const server = Bun.serve({ hostname: '127.0.0.1', port, fetch: createHandler({ ...deps, staticDir, vscode }) });
    const url = `http://127.0.0.1:${server.port}`;
    console.error(`criever ready: ${url}`);
    if (!noOpen) openBrowser(url);
    const stop = async () => { await vscode.stop(); process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  }
} catch (e) {
  // Bitbucket's own errors are written for the user too — printing a stack here dumps
  // the whole minified bundle over the terminal and buries the message that names the fix.
  if (e instanceof UserError || e instanceof BitbucketError || e instanceof GitHubError) { console.error(e.message); process.exit(1); }
  throw e;
}
