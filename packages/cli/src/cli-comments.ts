import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { Side } from '@criever/shared';
import { UserError } from './errors';
import { Git } from './git';
import { LocalReviewStore } from './localreview';

function parseFlags(args: string[], known: Set<string>, boolFlags: Set<string> = new Set()): { flags: Record<string, string | boolean>; positional: string[] } {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith('--')) {
      if (!known.has(a)) throw new UserError(`Unknown flag: ${a}\nSupported flags: ${[...known].join(', ')}.`);
      flags[a] = boolFlags.has(a) ? true : (args[++i] ?? '');
    } else positional.push(a);
  }
  return { flags, positional };
}

async function readBody(flags: Record<string, string | boolean>): Promise<string> {
  const body = flags['--body'];
  const bodyFile = flags['--body-file'];
  if (typeof body === 'string') return body;
  if (typeof bodyFile === 'string') {
    const text = bodyFile === '-' ? await Bun.stdin.text() : await readFile(bodyFile, 'utf8');
    return text.replace(/\n$/, '');
  }
  throw new UserError('Provide --body <text> or --body-file <path|->.');
}

const ADD_FLAGS = new Set(['--path', '--line', '--side', '--body', '--body-file', '--reply-to', '--author', '--agent-name']);

async function cmdAdd(store: LocalReviewStore, git: Git, args: string[]): Promise<number> {
  const { flags } = parseFlags(args, ADD_FLAGS);
  const path = flags['--path'];
  if (typeof path !== 'string') throw new UserError('Missing --path <file>.\nExample: criever comment add --path src/x.ts --line 10 --body "..."');
  const lineRaw = flags['--line'];
  if (typeof lineRaw !== 'string') throw new UserError('Missing --line <n>.\nExample: criever comment add --path src/x.ts --line 10 --body "..."');
  const line = Number(lineRaw);
  if (!Number.isInteger(line) || line < 1) throw new UserError(`--line must be a positive integer, got "${lineRaw}".`);

  const side = (flags['--side'] as string | undefined) ?? 'new';
  if (side !== 'new' && side !== 'old') throw new UserError(`--side must be "new" or "old", got "${side}".`);

  const author = (flags['--author'] as string | undefined) ?? 'agent';
  if (author !== 'agent' && author !== 'me') throw new UserError(`--author must be "agent" or "me", got "${author}".`);

  const agentName = flags['--agent-name'] as string | undefined;
  const body = await readBody(flags);
  const anchorCommit = (await git.run(['rev-parse', 'HEAD'])).stdout.trim();

  const draft = { path, line, side: side as Side, body, author: author as 'me' | 'agent', anchorCommit, ...(agentName ? { agentName } : {}) };

  const replyToRaw = flags['--reply-to'] as string | undefined;
  if (replyToRaw != null) {
    const parentId = Number(replyToRaw);
    const c = await store.reply(parentId, draft);
    if (!c) throw new UserError(`No such root comment ${replyToRaw}.\nCheck the id with: criever comments list.`);
    console.log(`Added reply ${c.id} to comment ${parentId}.`);
    return 0;
  }
  const c = await store.add(draft);
  console.log(`Added comment ${c.id}.`);
  return 0;
}

async function cmdResolve(store: LocalReviewStore, positional: string[]): Promise<number> {
  const idRaw = positional[0];
  if (!idRaw) throw new UserError('Missing <id>.\nUsage: criever comment resolve <id>');
  const ok = await store.resolve(Number(idRaw));
  if (!ok) throw new UserError(`No such comment ${idRaw} to resolve.\nCheck the id with: criever comments list.`);
  console.log(`Resolved comment ${idRaw}.`);
  return 0;
}

async function cmdRemove(store: LocalReviewStore, positional: string[]): Promise<number> {
  const idRaw = positional[0];
  if (!idRaw) throw new UserError('Missing <id>.\nUsage: criever comment rm <id>');
  const ok = await store.remove(Number(idRaw));
  if (!ok) throw new UserError(`No such comment ${idRaw} to remove.\nCheck the id with: criever comments list.`);
  console.log(`Removed comment ${idRaw}.`);
  return 0;
}

const LIST_FLAGS = new Set(['--json', '--unresolved', '--mine', '--agent', '--path']);
const LIST_BOOL_FLAGS = new Set(['--json', '--unresolved', '--mine', '--agent']);

function cmdList(store: LocalReviewStore, args: string[]): number {
  const { flags } = parseFlags(args, LIST_FLAGS, LIST_BOOL_FLAGS);
  const comments = store.review.comments;
  const repliesOf = (id: number) => comments.filter(c => c.parentId === id);

  let roots = comments.filter(c => c.parentId === null);
  if (flags['--unresolved']) roots = roots.filter(c => !c.resolved);
  if (flags['--mine']) roots = roots.filter(c => c.author === 'me');
  if (flags['--agent']) roots = roots.filter(c => c.author === 'agent');
  if (typeof flags['--path'] === 'string') roots = roots.filter(c => c.path === flags['--path']);

  const shape = roots.map(root => ({
    id: root.id, path: root.path, line: root.line, side: root.side, author: root.author,
    ...(root.agentName ? { agentName: root.agentName } : {}),
    body: root.body, resolved: root.resolved,
    replies: repliesOf(root.id).map(r => ({
      id: r.id, author: r.author, ...(r.agentName ? { agentName: r.agentName } : {}), body: r.body,
    })),
  }));

  if (flags['--json']) { console.log(JSON.stringify(shape, null, 2)); return 0; }
  if (shape.length === 0) { console.log('No comments.'); return 0; }
  for (const t of shape) {
    const loc = t.path ? `${t.path}:${t.line ?? '?'}` : '(review-level)';
    const who = t.author === 'agent' ? `agent${t.agentName ? `:${t.agentName}` : ''}` : 'me';
    console.log(`#${t.id} [${who}]${t.resolved ? ' resolved' : ''} ${loc} — ${t.body.split('\n')[0]}`);
    for (const r of t.replies) {
      const rwho = r.author === 'agent' ? `agent${r.agentName ? `:${r.agentName}` : ''}` : 'me';
      console.log(`    ↳ #${r.id} [${rwho}] ${r.body.split('\n')[0]}`);
    }
  }
  return 0;
}

/** Entry point for `criever comment …` / `criever comments …`, dispatched before the server starts. */
export async function runCommentsCli(argv: string[], cwd: string): Promise<number> {
  try {
    const git = await Git.open(cwd);
    const reviewPath = LocalReviewStore.path(git.root);
    if (!existsSync(reviewPath)) {
      console.error('No local review found in this repo.\nRun `criever --local` first to start one.');
      return 2;
    }
    const store = new LocalReviewStore(reviewPath);
    await store.load();

    const [cmd, sub, ...rest] = argv;
    if (cmd === 'comment') {
      if (sub === 'add') return await cmdAdd(store, git, rest);
      if (sub === 'resolve') return await cmdResolve(store, rest);
      if (sub === 'rm') return await cmdRemove(store, rest);
      throw new UserError(`Unknown subcommand "comment ${sub}".\nUse one of: comment add, comment resolve <id>, comment rm <id>.`);
    }
    if (cmd === 'comments') {
      if (sub === 'list') return cmdList(store, rest);
      throw new UserError(`Unknown subcommand "comments ${sub}".\nUse: comments list.`);
    }
    throw new UserError(`Unknown command "${cmd}".\nUse: comment add|resolve|rm, or comments list.`);
  } catch (e) {
    if (e instanceof UserError) { console.error(e.message); return 1; }
    throw e;
  }
}
