# criever

criever is a local code review tool. Against a Bitbucket Cloud or GitHub.com pull request, it runs inside your repo, finds the open PR for the checked-out branch, and serves a review UI in your browser that re-anchors existing comments when the PR moves and lets you drill into the rest of the codebase without leaving the diff — comments are drafted locally and published when you're done. It also runs with no provider at all (`--local`), diffing any two git refs, which is how you hand a review back and forth with an AI agent — see "Local reviews and the agent loop" below.

## Install

Requires Bun >= 1.3 and git >= 2.28.

```
./scripts/install.sh
```

This runs `bun install`, `bun run build`, and symlinks `dist/criever` to `~/.local/bin/criever`. Make sure `~/.local/bin` is on your `PATH`.

## Credentials

### GitHub

Supply a GitHub personal access token in this order of precedence:

1. `GITHUB_TOKEN`
2. `GH_TOKEN`
3. `github.token` in `~/.config/criever/config.json`

For example:

```sh
export GITHUB_TOKEN="<github-token>"
```

or configure the file:

```json
{ "github": { "token": "<github-token>" } }
```

For a fine-grained PAT, select the repository and grant **Contents: read** and
**Pull requests: read/write**. For a classic PAT, use **repo** for private
repositories or **public_repo** for public repositories. Authorize the token for
your organization's SSO as needed. criever does not implicitly use `gh auth`;
signing into the GitHub CLI alone does not supply its credentials.

### Bitbucket Cloud

Supply Bitbucket credentials through environment variables:

```
ATLASSIAN_USER_EMAIL=reviewer@example.test
ATLASSIAN_API_TOKEN=<bitbucket-token>
```

or configure `~/.config/criever/config.json`:

```json
{ "email": "reviewer@example.test", "token": "<bitbucket-token>" }
```

Use the credential source required by your Bitbucket deployment.

Other env overrides: `BITBUCKET_API_BASE` (default `https://api.bitbucket.org/2.0`), `CRIEVER_STATE_DIR` (default `~/.local/share/criever`), `CRIEVER_CACHE_DIR` (default `~/.cache/criever`), `XDG_CONFIG_HOME` (changes where the config file above is read from).

## AI assistance

Install and sign in to a supported local CLI (Claude Code, Codex, or OpenCode), then list the harnesses you want to use in `~/.config/criever/config.json` (or `$XDG_CONFIG_HOME/criever/config.json`):

```json
{
  "harnesses": [
    { "id": "claude", "name": "Claude", "kind": "claude" },
    { "id": "codex", "name": "Codex", "kind": "codex" },
    { "id": "opencode", "name": "OpenCode", "kind": "opencode" },
    { "id": "gemini", "name": "Gemini ACP", "kind": "acp", "executable": "gemini", "args": ["--experimental-acp"] }
  ]
}
```

The optional `executable` field points to a CLI binary when it is not on `PATH`. The `acp` kind connects to any ACP v1 agent over standard input and output; its `executable` is required and `args` is optional. ACP agents must provide their own filesystem and command execution tools. During reviews, Criever grants one-time read, search, and execution permission requests so the agent can install dependencies and run checks; edit and other requests remain denied. Chat permission requests remain denied. Criever does not provide generic filesystem or terminal capabilities. Claude, Codex, and OpenCode keep their existing vendor-specific adapters. You can keep `email` and `token` in the same JSON file for Bitbucket reviews. A harness is invoked only when you ask a question, request a rewording, or press **Run AI review**; no automatic review runs at startup. The CLI runs from the reviewed repository, so only configure harnesses you trust with that repository's contents. AI chat and review need an installed, authenticated harness but no Bitbucket credentials in `--local` mode.

Daemon review sessions load the same harness configuration when a checkout is prepared. AI runs inside that session's temporary checkout or selected repository, and private state stays scoped to the provider, repository, and pull request. Stopping the daemon or replacing a repository session stops its AI work before cleanup. Reopening a review restores saved conversations and completed reviews.

The header's **AI** button opens a closeable workbench rail. Select a harness for general questions or run reviews of the diff. A review prefers an available harness review skill; otherwise it follows Criever's detailed repository-inspection fallback. Reviews return immediately and the agent posts named progress steps, findings, and non-publishable **Look at this** notices while it works. The agent invokes Criever's `--ai` CLI over one authenticated loopback TCP endpoint. The endpoint accepts no posts without the per-review capability, and final agent prose is not parsed as the review result. Criever validates each changed-line anchor and observation before an explicit completion and successful harness exit make a run publishable. Failed or incomplete runs stay visible with provisional results that cannot be approved. This structural check cannot prove the agent discovered every issue or that its evidence is correct. The `--ai` CLI only accepts posts from the running review subprocess; its capability is not in the prompt or browser API. OpenCode reviews receive immutable file snapshots at both review revisions. You can start several reviews and keep chatting while they run. The compact **Chat** and **Findings** tabs retain completed runs, including empty ones, and display provisional results for running reviews; select any anchored item to jump to its line. Results and conversations persist after closing the rail or refreshing the page. Click or focus and press Enter on a diff-line gutter **+** to open the composer, then choose **PR comment** or **Ask AI privately**; the latter opens a private, multi-turn Q&A thread on that line using the code at that revision, never a PR draft. AI findings and independently anchored look-outs also appear beside changed lines and in the regular comments rail while the AI rail is closed. AI answers, findings, and look-outs display Markdown paragraphs, lists, and code examples. Findings can be edited, reworded, or deleted; look-outs are guidance, not publishable findings.

AI reviews can install missing dependencies and run relevant tests, typechecks, builds, and generation steps, including in fresh temporary checkouts under `/tmp`. The agent is instructed to use the pinned package manager and lockfile, keep caches and generated files in writable workspace/temporary locations, preserve tracked files and existing user changes, and use a separate pinned checkout when necessary. Claude and Codex keep filesystem sandboxing while allowing workspace writes and dependency download access; OpenCode permits shell commands, and ACP execution depends on the configured agent. Tracked-file preservation is an instruction to the review agent, not a filesystem guarantee for commands or install scripts.

**Complete** means the agent finished inspecting the committed change and classified its observations; it is not a test-pass or correctness certificate. Missing installed dependencies or an unavailable runtime check alone should not block completion: a concrete unresolved concern belongs in a look-out with its verification limit and a focused next check. **Incomplete** means inspection or classification could not finish, for example because essential changed source was inaccessible or the investigation was interrupted.

All AI content is kept in the review's private state. Neither Q&A nor look-outs are published or saved as review comments. Findings also stay private until you explicitly choose **Approve draft** for each one. Only approved drafts enter the existing **Publish** (Bitbucket or GitHub) or **Save** (`--local`) flow; check the draft before completing that step. Reopening the same review retains its AI conversations and decisions.

## Use

### Project workspace (daemon mode)

Start Criever once, from any directory:

```sh
criever daemon
# Equivalent: criever --daemon
```

The long-running process opens `http://127.0.0.1:4917`. Leave it running while
reviewing; Ctrl+C stops it. Use `--no-open` to open the address yourself, or
`--port <n>` to choose another port (`--port 0` picks an available port).
It binds only to loopback, not your network interface. It runs in the foreground;
it does not install an operating-system service.

1. Choose **Add project** and start typing the repository path. Matching folders
   on the daemon machine appear as you type, including for incomplete names such
   as `~/pro`. Click a suggestion, or use arrow keys and Enter/Tab to complete it;
   keep typing to navigate into subfolders. Escape dismisses suggestions without
   closing the dialog. You can also enter an exact path directly, including `~`
   or `~/projects/repository` for the daemon user's home directory.
   Its GitHub.com or Bitbucket Cloud remote determines the provider. Configure
   credentials as described above; adding a project does not clone a repository.
2. Open a project to see its open pull requests and which request your review.
3. Open a PR, choose **Temporary checkout** or **Actual repository**, and confirm.
   Temporary checkout is the default: an isolated worktree in the system temporary
   directory (`/tmp` on Linux), leaving your original checkout alone. Actual
   repository switches your local checkout to the PR commit in detached HEAD;
   it requires a clean working tree and stays checked out when you leave.
   Both modes open the usual diff, comments, drafts, and publishing tools.
4. Return to the project or Projects page whenever you need to switch context.
   **Mark reviewed** records the revision and discussion you have seen, locally
   only. It does not approve the PR, publish comments, or change assignments on
   the provider. It is available from the PR list and from a review session;
   **Clear reviewed** removes it and restores the status derived from your
   provider activity. If new discussion arrives on an unchanged commit, the PR
   needs a recheck again and can be acknowledged again.
5. The daemon periodically checks for changes while it is running. Refresh
   checks immediately; provider errors remain visible, and the last successful
   results stay on screen rather than being presented as current.

### Review filters

| Filter | Shows |
| --- | --- |
| **All open** | Every open PR. |
| **Assigned to me** | Every PR that lists you as a reviewer, including ones you already reviewed. |
| **Pending** | Assigned PRs where you have no published comment, approval, changes-requested decision, or local acknowledgement. |
| **Needs recheck** | PRs with new commits or new comments from others since your latest review activity or local acknowledgement. |

Your review activity is any non-deleted comment you published (inline, reply, or
general) and an explicit approval or changes-requested decision. Being listed as
a participant does not count. Your own later comments, title edits, and other
metadata changes never trigger a recheck. Each flagged card says why, using the
provider's author and timestamp when available, and shows every reason that
applies:

- `Since your review: PR commits changed.`
- `Since your review: New comment by Example Reviewer.` for a separate comment
  from someone else (including a reply in a thread you did not join).
- `Since your review: Reply in a thread you joined.`
- `Since your review: Changes requested by Example Reviewer.` (or `Approved`)
  for another reviewer's decision.

Status and explanations come from one shared derivation, so they cannot
disagree. A discussion-only change is never described as a code change, and an
independent comment is never described as a reply.

**Bitbucket specifics.** Bitbucket's list response omits reviewers and
participants unless asked, so Criever requests
`fields=+values.reviewers,+values.participants` (with the plus signs encoded)
and fetches individual PR details if they are still missing. Your identity is the
UUID returned by `/user`. Provider requests are made with bounded concurrency.

**Initial-sync limitation.** Bitbucket does not record which commit you
reviewed. The first time Criever sees your review activity on a PR, it compares
commit dates with the time of that activity and then stores the reviewed
revision. From then on head changes are detected by revision, including force
pushes with older commit dates and across daemon restarts. A force push made
*before* that first sync, whose commit dates are older than your review, cannot
be detected, and a PR first synced after later commits will show those commits
as changed. Marking reviewed locally sets an exact baseline. GitHub PRs use
review requests and local acknowledgement only.

GitHub assignments include direct review requests and team requests when the
token can read your team memberships. If GitHub denies that lookup, only direct
requests are identified. Bitbucket assignments use the PR's reviewer list
matched against your account UUID.

Projects and reviewed revisions survive daemon restarts in
`CRIEVER_STATE_DIR/workspace.json` (default
`~/.local/share/criever/workspace.json`). Review drafts retain the existing
provider/repository/PR storage. Browser review sessions belong to the running
daemon; after restarting, reopen the PR from its project.

Only one daemon can own a state directory at a time. After an unclean exit, the
startup error identifies `workspace.lock` and its recorded process ID; remove
that lock only after confirming the old process has exited. Clean temporary
worktrees are removed at shutdown; worktrees containing edits or ignored files
are preserved and their paths are printed. Actual repository checkouts are never
removed or automatically restored by daemon shutdown.

Daemon mode selects review context in the browser, so `--local`, `--base`, and
`--head` belong to single-repository mode, not daemon mode.

### Single-repository mode

```
cd your-repo
criever
```

criever resolves the remote as `origin` if one exists, or the single remote in the repo otherwise (it errors and names what it found if that's ambiguous). Bitbucket Cloud and GitHub.com remotes are supported; GitHub accepts SSH (`git@github.com:<owner>/<repo>.git` or `ssh://git@github.com/<owner>/<repo>.git`) and HTTPS (`https://github.com/<owner>/<repo>.git`). It then looks for an open PR for the currently checked-out branch and opens the review UI in your default browser.

Flags: `--port <n>` (fixed port instead of a random free one), `--no-open` (don't launch a browser), `--dev` (serve the API only, for use with `bun run dev:web` against a running Vite dev server).

Or skip all of the above and review any two git refs with no provider at all — see "Local reviews and the agent loop" below.

### Publishing to GitHub

Create drafts in the browser, then use **Publish** to review and send them.
GitHub root comments are published in one **COMMENT** review batch; threaded
replies are published separately. This leaves comments rather than approving or
requesting changes on the PR.

Anchored root drafts must match the current PR head. If the head has changed
since a draft was created, publishing rejects that stale draft: remove it and
recreate it against the current head before publishing again. Editing only its
text does not refresh its anchor. The publish sheet shows API failures and keeps
unsent comments as drafts.

GitHub review threads support replies and resolution. PR conversation comments are
shown read-only, with no Reply or Resolve action, and ignore the `r` shortcut.

### Keyboard

| Key | Action |
|---|---|
| `⌘K` | file palette |
| `o` | overview: description + commits |
| `⌘⇧F` | repo search |
| `⌘F` | find in file |
| `] [` | next / previous file |
| `j k` | next / previous hunk |
| `n p` | next / previous thread |
| `↓ ↑` | move cursor to next / previous line |
| `c` | comment on cursor line |
| `v` | toggle viewed |
| `.` | open in VS Code at cursor |
| `u` | unified / split toggle |
| `r` | resolve focused thread |
| `⌘↩` | publish (opens the sheet) |
| `Esc` | close overlays |

Ctrl works as ⌘ on Linux/Windows. `?` opens a keymap overlay in the app.

## Overview and commit ranges

`o`, or clicking the PR title in the header, opens the overview: the pull request's description
rendered as markdown, and the commits that make it up, newest first. A local review has no pull
request and so no description — the commit list is the whole story there, and the panel says so
rather than showing an empty box.

Clicking a commit scopes the entire review to it: the file list, the diff, and the counts all
narrow to what that one commit changed. Shift-clicking a second commit spans the range between
them. "whole review" (or the ✕ on the header chip) puts it back.

Two ranges are reachable without opening the panel at all: **show diff** in the "new commits since
your last visit" banner scopes the review to what landed since you were last here, and **whole file
since my comment** on a moved comment scopes it to what changed since that comment was written.

Comments stay anchored to the review's head, which is the only place their line numbers are
authoritative. So a range that *ends* at the head — since-your-last-visit, since-my-comment, the
newest N commits — keeps comments and the composer fully live, and a range that ends earlier is
**read-only**: the header chip says so, comment cards are hidden rather than drawn at lines they
don't belong to, and the gutter won't start a new comment. Clear the range to comment again.

## Local reviews and the agent loop

criever also runs with no PR, no provider account, and no network:

```
criever --local [--base <ref>] [--head <ref>]
```

`--head` defaults to `HEAD`. `--base` defaults to the merge-base between `HEAD` and the repo's default branch, resolved from the remote's `HEAD` symlink if there's a remote, else a local `main` or `master`. If none of those can be found, criever fails with:

```
Can't find a default branch to diff against (checked the remote's HEAD, main, master).
Pass --base <ref> explicitly.
```

The header shows `local review · <base>..<head>` instead of a PR title, and the Publish button becomes **Save** — there's nothing to send anywhere; Save moves your drafts into the shared review file where an agent can read them. Agent-authored comments get a distinct avatar and an agent-name chip, and the rail gains a "From the agent" group.

### Flow A — the agent reviews, you gate what goes out

The agent inspects the diff and writes its findings as comments; you read them in the UI next to the diff, delete the noise, edit the wording, reply where you disagree, and publish the survivors to the real PR. The agent never talks to Bitbucket or GitHub.

```
$ criever --local --no-open --port 4818 &
$ criever comment add --path src/api/devices.ts --line 42 \
    --body "N+1 query: this issues one SELECT per device inside the loop." \
    --agent-name coding-agent
Added comment 1.
```

Open `http://127.0.0.1:4818`, review the finding against the diff, edit/delete/reply as you like, then check out the real PR branch and run plain `criever` to publish the survivors.

### Flow B — you review, the agent acts

You leave comments in the UI as normal — they're drafts until you press **Save** (see below). The agent then works the queue:

```
$ criever comments list --json --unresolved
[
  { "id": 1, "path": "src/api/devices.ts", "line": 42, "side": "new", "author": "me",
    "body": "N+1 query here, please fix", "resolved": false, "replies": [] }
]
$ criever comment add --reply-to 1 --agent-name coding-agent \
    --body "Fixed in c0ffee1: batched the lookup."
Added reply 2 to comment 1.
$ criever comment resolve 1
Resolved comment 1.
$ criever comments list --json --unresolved
[]
```

Reopen criever and the reply shows against the (possibly moved) line, resolved.

### The CLI contract

```
criever comment add --path <p> --line <n> [--side new|old] \
                     --body <text> | --body-file <path|-> \
                     [--reply-to <id>] [--author agent|me] [--agent-name <name>]
criever comments list [--json] [--unresolved] [--mine] [--agent] [--path <p>]
criever comment resolve <id>
criever comment rm <id>
```

These work whether or not the UI is running — they operate directly on `.criever/review.json`.

- `--body-file -` reads stdin, so an agent can pipe a multi-line finding without quoting hell.
- Default `--author` is `agent` for `comment add` (the CLI is the agent's surface); the UI writes `me`. Both are overridable.
- `--json` shape, replies nested under their root:
  ```json
  [{ "id": 3, "path": "src/api/devices.ts", "line": 42, "side": "new", "author": "agent",
     "agentName": "coding-agent", "body": "N+1 query here", "resolved": false,
     "replies": [{ "id": 4, "author": "me", "body": "fixed in c0ffee1, recheck" }] }]
  ```
- Exit codes: `0` success, `1` a user error (message names the fix), `2` no local review in this repo (`run criever --local first`).

### Where comments live

`<repo>/.criever/review.json` — gitignored by default, because a local review is scratch. Committing it anyway is a deliberate opt-in for handing a whole review to someone else. The CLI and a running criever UI read and write the same file safely: atomic `.tmp` + rename behind a serialized write queue, plus an advisory cross-process `.lock`, tested against concurrent writers.

### Drafts are private until you press Save

A comment you write in the browser is a **draft**: it lives in your browser session only, not yet in `.criever/review.json`. The agent can't see it and `criever comments list` won't show it until you press **Save** (or `⌘↩`). This is the same gate as "publish" in the Bitbucket flow, it just moves in-repo instead of out to Bitbucket — but it's easy to forget when there's no PR involved, so: if you're waiting for the agent to react to something you just typed, check you saved it first.

### Writing an agent prompt

A few lines in your agent's instructions are enough:

> Review the diff and record each finding with
> `criever comment add --path <file> --line <n> --body "<finding>" --agent-name <you>`.
> Then check for responses with `criever comments list --json --agent`, and once you've
> addressed one, resolve it with `criever comment resolve <id>`.

## Where state lives

Drafts, viewed status, and re-anchored comment positions are saved per PR:

- Bitbucket: `~/.local/share/criever/<workspace>/<repo>/pr-<id>.json`
- GitHub: `~/.local/share/criever/github/<owner>/<repo>/pr-N.json`, where `N` is the PR number.

`CRIEVER_STATE_DIR` overrides the state root. GitHub state is namespaced separately
from Bitbucket state. Nothing is written to the git repo for provider reviews.
If a state file is corrupt it's moved aside to `.bak`, criever starts with empty
state, and the UI shows a warning banner.

## VS Code escape hatch

Pressing `.` (or the "Open in VS Code" button) opens the current file at the cursor line in a bundled openvscode-server, running against your real working tree. First use downloads the pinned openvscode-server release (~150 MB) into `~/.cache/criever`; later opens reuse the same instance. Only one instance runs per criever process, and it's one-way — nothing flows back from VS Code into criever.

## Development

```
bun run dev:cli -- --dev --port 4711
CRIEVER_PORT=4711 bun run dev:web
```

Tests: `bun run test` (per-package Vitest) and Playwright e2e in `packages/web/e2e`. `bun run build` produces the single `dist/criever` binary with the UI embedded.

## Troubleshooting

| Message | What to do |
|---|---|
| Unsupported remote host | Use a Bitbucket Cloud or GitHub.com remote, not a GitHub Enterprise host. |
| No git remotes / no remote named "origin" (several found) | Add a supported remote (for example `git remote add origin git@github.com:<owner>/<repo>.git`) or rename the intended one to `origin` (`git remote rename <name> origin`). |
| HEAD is detached | Check out the PR branch first. |
| No open PR for `<branch>` in `<ws>/<repo>` | Push the branch and open a PR, or check out the branch that has one. |
| 401 / 403 | For GitHub, check the token selected by `GITHUB_TOKEN`, `GH_TOKEN`, then config, its repository permissions/scopes, and SSO authorization. For Bitbucket, check `ATLASSIAN_API_TOKEN` / `ATLASSIAN_USER_EMAIL` or the config file at the printed path. |
| 429 | criever waits once for the `Retry-After` period, then fails with a message if Bitbucket is still rate-limiting. |
| git fetch failed | git's own stderr is printed verbatim; fix whatever git is complaining about (network, auth, ref). |
| Publish partial failure | The publish sheet stays open; failed rows show the API's message. Successful comments are already published; failed and unsent comments remain drafts. Fix and retry. |
| Stale GitHub root draft | Remove and recreate the anchored draft against the current PR head. Editing the text alone does not refresh its anchor. |
| Resolve failed | The optimistic UI change is rolled back and a toast shows the error. |
| State file corrupt | It's renamed to `.bak`, criever starts with empty state for that PR, and a warning banner explains it. |
| VS Code download failed | A toast shows the download URL and cache path; fetch the tarball manually into that path if your network blocks GitHub releases. |
| Any other git subprocess failure | Surfaced as a 500 with git's stderr; the UI shows it in place of the pane's content. |

## Known ceilings

- Syntax highlighting is per-line, so multi-line strings and comments can mis-colour.
- Comment position highlighting in the diff is display-only — Bitbucket has no range anchor for comments, so only the start line is authoritative.
- Only one openvscode-server instance runs per criever process.
