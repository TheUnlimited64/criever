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

1. Choose **Add project**, then **Browse folders** to select an existing local
   Git checkout. Home and Up navigate folders on the machine running the daemon;
   **Use this folder** fills the project path. You can also type a path, including
   `~` or `~/projects/repository` for the daemon user's home directory.
   Its GitHub.com or Bitbucket Cloud remote determines the provider. Configure
   credentials as described above; adding a project does not clone a repository.
2. Open a project to see its open pull requests and which request your review.
3. Open a PR and confirm checkout. Criever prepares a separate local review
   worktree, leaving your original checkout alone, then opens the usual diff,
   comments, drafts, and publishing tools.
4. Return to the project or Projects page whenever you need to switch context.
   **Mark reviewed** records the revision you reviewed locally. It does not
   approve the PR or publish anything to the provider.
5. The daemon periodically checks for changes while it is running. A reviewed
   PR whose head changes appears as updated on Projects, including force-pushed
   revisions. Refresh checks immediately; provider errors remain visible rather
   than silently presenting cached results as current.

GitHub assignments include direct review requests and team requests when the
token can read your team memberships. If GitHub denies that lookup, only direct
requests are identified. Bitbucket assignments use the PR's reviewer list.

Projects and reviewed revisions survive daemon restarts in
`CRIEVER_STATE_DIR/workspace.json` (default
`~/.local/share/criever/workspace.json`). Review drafts retain the existing
provider/repository/PR storage. Browser review sessions belong to the running
daemon; after restarting, reopen the PR from its project.

Only one daemon can own a state directory at a time. After an unclean exit, the
startup error identifies `workspace.lock` and its recorded process ID; remove
that lock only after confirming the old process has exited. Clean session
worktrees are removed at shutdown; worktrees containing edits or ignored files
are preserved and their paths are printed.

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
