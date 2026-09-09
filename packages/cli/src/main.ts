#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { BitbucketError } from './bitbucket';
import { runCommentsCli } from './cli-comments';
import { UserError } from './errors';
import { createHandler } from './server';
import { startup } from './startup';
import { createVscode } from './vscode';

const args = process.argv.slice(2);
if (args[0] === 'comment' || args[0] === 'comments') process.exit(await runCommentsCli(args, process.cwd()));

const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const port = +(flag('--port') ?? 0);
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
  if ((base || head) && !local) throw new UserError('--base/--head require --local.\nAdd --local, or drop --base/--head for a Bitbucket PR review.');
  const deps = await startup({ cwd: process.cwd(), env: process.env, log: s => console.error(s), local, base, head });
  const staticDir = dev ? null : 'embedded';
  const vscode = createVscode({ repoRoot: deps.git.root, cacheDir: (await import('./config')).defaultPaths(process.env).cacheDir, log: s => console.error(s) });
  const server = Bun.serve({ hostname: '127.0.0.1', port, fetch: createHandler({ ...deps, staticDir, vscode }) });
  const url = `http://127.0.0.1:${server.port}`;
  console.error(`criever ready: ${url}`);
  if (!noOpen) openBrowser(url);
  const stop = async () => { await vscode.stop(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch (e) {
  // Bitbucket's own errors are written for the user too — printing a stack here dumps
  // the whole minified bundle over the terminal and buries the message that names the fix.
  if (e instanceof UserError || e instanceof BitbucketError) { console.error(e.message); process.exit(1); }
  throw e;
}
