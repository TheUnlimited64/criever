import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { BitbucketClient, BitbucketError } from './bitbucket';
import { defaultPaths, loadCredentials, loadHarnesses } from './config';
import { AiAdapter } from './ai';
import { UserError } from './errors';
import { Git } from './git';
import { LocalReviewStore } from './localreview';
import { BitbucketProvider, rawPrToMeta } from './provider';
import { LocalProvider } from './providers/local';
import { parseRemote } from './remote';
import type { ServerDeps } from './server';
import { StateStore } from './state';

type Env = Record<string, string | undefined>;

/**
 * Mode selection: a PR needs credentials, a provider remote, and an actual open PR to
 * be found. Any one of those missing falls back to local mode rather than failing — but a remote
 * that resolves to an unsupported provider, a detached HEAD, or a failed fetch are real problems
 * with the repo/PR itself and still hard-error, same as v1.
 */
export async function startup(opts: { cwd: string; env: Env; fetch?: typeof fetch; log: (s: string) => void; local?: boolean; base?: string; head?: string }): Promise<Omit<ServerDeps, 'staticDir' | 'vscode'>> {
  const paths = defaultPaths(opts.env);
  const git = await Git.open(opts.cwd);
  const ai = new AiAdapter(await loadHarnesses(paths.configPath), git);
  if (opts.local) return { ...(await startupLocal(opts, paths, git)), ai };

  let remote: string; let url: string;
  try {
    ({ name: remote, url } = await git.resolveRemote());
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    return { ...(await startupLocal(opts, paths, git, 'no git remote')), ai };
  }
  const { workspace: ws, repo } = parseRemote(url); // a remote that isn't a supported provider is still a hard error
  const branch = await git.currentBranch(); // detached HEAD is still a hard error

  let creds: { email: string; token: string };
  try {
    creds = await loadCredentials(opts.env, paths.configPath);
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    return { ...(await startupLocal(opts, paths, git, 'no Bitbucket credentials')), ai };
  }
  const bb = new BitbucketClient({ base: opts.env.BITBUCKET_API_BASE ?? 'https://api.bitbucket.org/2.0', ...creds, fetch: opts.fetch });

  opts.log(`Looking for an open PR for ${branch} in ${ws}/${repo}…`);
  let pr;
  try {
    pr = await bb.findOpenPr(ws, repo, branch);
  } catch (e) {
    // A provider error aborts startup (rightly — quietly going local on an access problem would
    // leave someone wondering why their PR comments never show up), but it's still a dead end
    // without pointing at the escape hatch.
    if (e instanceof BitbucketError) throw new BitbucketError(e.status, e.body, `${e.message}\n\nYou can still review locally without a provider: criever --local`);
    throw e;
  }
  if (!pr) return { ...(await startupLocal(opts, paths, git, `no open PR for ${branch} in ${ws}/${repo}`)), ai };
  opts.log(`PR #${pr.id}: ${pr.title}`);

  await git.fetch(remote, [pr.source.branch.name, pr.destination.branch.name]);
  const mergeBase = await git.mergeBase(pr.destination.commit.hash, pr.source.commit.hash);
  const [comments, commits] = await Promise.all([bb.listComments(ws, repo, pr.id), bb.listCommits(ws, repo, pr.id)]);
  const store = new StateStore(StateStore.path(paths.stateDir, ws, repo, pr.id)); await store.load();
  if (store.warning) opts.log(store.warning);

  // Carry over unresolved comments left in .criever/review.json before this PR was found as drafts,
  // so the Publish sheet can be reviewed before anything is sent. load() is a no-op when the file doesn't exist.
  const localReview = new LocalReviewStore(LocalReviewStore.path(git.root));
  await localReview.load();
  await carryOverLocalComments(localReview, store, pr.id);

  const provider = new BitbucketProvider(bb, ws, repo, pr.id);
  return { git, store, provider, ws, repo, meta: rawPrToMeta(pr), mergeBase, comments, commits, remote, localReview, ai };
}

/**
 * Loads unresolved local comments not yet published to this PR as drafts. Idempotent by
 * construction: a comment already marked `publishedTo` for this PR, or already sitting in the
 * draft store as a pending carry-over, is skipped — restarting criever before or after
 * publishing never offers the same comment twice.
 */
async function carryOverLocalComments(review: LocalReviewStore, store: StateStore, prId: number): Promise<void> {
  const publishedHere = new Map(
    review.review.comments.filter(c => c.publishedTo?.prId === prId).map(c => [c.id, c.publishedTo!.commentId]),
  );
  for (const c of review.review.comments) {
    if (c.resolved || c.path == null || c.line == null) continue; // resolved: dealt with; review-level: no Draft shape for it
    if (publishedHere.has(c.id)) continue;
    if (store.state.drafts.some(d => d.sourceLocalId === c.id)) continue;
    let parentId: number | undefined;
    if (c.parentId != null) {
      const parentCommentId = publishedHere.get(c.parentId);
      if (parentCommentId == null) continue; // parent never published here: nothing to reply to, so keep it local
      parentId = parentCommentId;
    }
    await store.addDraft({
      path: c.path, line: c.line, side: c.side, body: c.body, anchorCommit: c.anchorCommit,
      sourceLocalId: c.id, author: c.author, ...(c.agentName ? { agentName: c.agentName } : {}), ...(parentId != null ? { parentId } : {}),
    });
  }
}

/** The repo's default branch as a ref merge-base can use directly: the remote's HEAD symlink when a
 * remote exists, else a local `main`/`master`. Never guessed silently — callers without a resolvable
 * default must ask the user for `--base`. */
async function defaultBranchRef(git: Git): Promise<string | null> {
  let remote: string | null = null;
  try { ({ name: remote } = await git.resolveRemote()); } catch { /* no remote at all */ }
  if (remote) {
    const r = await git.run(['symbolic-ref', `refs/remotes/${remote}/HEAD`], { allowFail: true });
    if (r.code === 0) return r.stdout.trim(); // e.g. "refs/remotes/origin/main", itself a valid rev
  }
  for (const candidate of ['main', 'master']) {
    const r = await git.run(['rev-parse', '--verify', '--quiet', candidate], { allowFail: true });
    if (r.code === 0) return candidate;
  }
  return null;
}

const CRIEVER_EXCLUDE_ENTRY = '/.criever/';

/**
 * Keeps `.criever/` out of `git status` for the repo being reviewed — never the user's tracked
 * `.gitignore` (criever never modifies the working tree), but `.git/info/exclude`,
 * which is per-clone, never committed, and exists precisely for local-only ignore rules.
 * Idempotent by content (an equivalent line already present is left alone, so this is safe to
 * call on every local-mode startup, not just the first), append-only (never rewrites or reorders
 * existing rules, and repairs a missing trailing newline first so the previous last rule survives),
 * and best-effort: a read-only checkout, unusual worktree, or missing info/ dir must never fail
 * the review over this.
 */
async function excludeCrieverDir(git: Git, log: (s: string) => void): Promise<void> {
  try {
    // git resolves the real git-dir for a linked worktree or submodule, where `.git` isn't a
    // plain directory under root — never assume `<root>/.git/info/exclude`.
    const r = await git.run(['rev-parse', '--git-path', 'info/exclude'], { allowFail: true });
    if (r.code !== 0) return;
    const excludePath = resolve(git.root, r.stdout.trim());
    let content = '';
    try { content = await readFile(excludePath, 'utf8'); } catch { /* doesn't exist yet */ }
    if (content.split('\n').some(l => l.trim() === CRIEVER_EXCLUDE_ENTRY)) return;
    const sep = content === '' || content.endsWith('\n') ? '' : '\n';
    await mkdir(dirname(excludePath), { recursive: true });
    await appendFile(excludePath, `${sep}${CRIEVER_EXCLUDE_ENTRY}\n`);
    log(`Added ${CRIEVER_EXCLUDE_ENTRY} to .git/info/exclude, so .criever/ won't show up in git status.`);
  } catch { /* best-effort: never fail the review over this */ }
}

async function startupLocal(opts: { env: Env; log: (s: string) => void; base?: string; head?: string }, paths: ReturnType<typeof defaultPaths>, git: Git, reason?: string): Promise<Omit<ServerDeps, 'staticDir' | 'vscode'>> {
  const head = opts.head ?? 'HEAD';
  let base = opts.base;
  if (!base) {
    const def = await defaultBranchRef(git);
    if (!def) throw new UserError(`Can't find a default branch to diff against (checked the remote's HEAD, main, master).\nPass --base <ref> explicitly.`);
    base = await git.mergeBase(def, head);
    const headSha = (await git.run(['rev-parse', head])).stdout.trim();
    if (base === headSha) {
      // The checked-out branch IS the default branch: merge-base(HEAD, default) == HEAD, which
      // would review an empty range. Fall back to the last commit instead of silently reviewing nothing.
      const parent = await git.run(['rev-parse', '--verify', '--quiet', `${head}~1`], { allowFail: true });
      if (parent.code !== 0) throw new UserError(`HEAD has no parent commit, so there's nothing to diff against the default branch.\nPass --base <ref> explicitly.`);
      base = parent.stdout.trim();
    }
  }
  const branch = await git.currentBranch();

  // No PR means no workspace/repo pair from Bitbucket; derive one from the remote when there is
  // one (so state stays alongside a same-repo Bitbucket review), else fall back to the repo's
  // directory name — a local review must work with no remote at all.
  let ws = 'local'; let repo = basename(git.root);
  try {
    const { url } = await git.resolveRemote();
    ({ workspace: ws, repo } = parseRemote(url));
  } catch { /* no remote at all: keep the directory-name fallback */ }

  const reviewStore = new LocalReviewStore(LocalReviewStore.path(git.root));
  await reviewStore.load();
  await reviewStore.ensureReview(base, head);
  if (reviewStore.warning) opts.log(reviewStore.warning);
  await excludeCrieverDir(git, opts.log);

  const provider = new LocalProvider(git, reviewStore, base, head, branch);
  const meta = await provider.meta();
  // Silently degrading is worse than failing: whichever fallback got us here is
  // announced on one line, so the user never wonders why their PR comments aren't showing up.
  opts.log(`${reason ? `${reason} — ` : ''}starting a local review ${meta.destinationHead.slice(0, 7)}..${meta.sourceHead.slice(0, 7)}`);
  const [comments, commits] = await Promise.all([provider.listComments(), provider.listCommits()]);

  // Local reviews use a fixed id (0) for the state path, unlike a PR's id — the
  // draft/anchor/viewed cache should survive base/head moving across sessions, since
  // .criever/review.json itself is one file per repo, not one per range.
  const store = new StateStore(StateStore.path(paths.stateDir, ws, repo, 0));
  await store.load();
  if (store.warning) opts.log(store.warning);

  // `base` may still be a ref (an explicit --base) rather than a sha; the diff endpoints
  // that use mergeBase need a resolved commit the way the Bitbucket flow already provides.
  const mergeBase = (await git.run(['rev-parse', base])).stdout.trim();
  return { git, store, provider, ws, repo, meta, mergeBase, comments, commits, remote: '' };
}
