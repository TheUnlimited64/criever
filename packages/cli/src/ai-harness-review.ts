import type { HarnessKind } from './config';

export interface ReviewLaunch {
  readonly command: string;
  readonly socket?: string;
  readonly url?: string;
  readonly repository: string;
}

export function reviewArgs(kind: HarnessKind, context: ReviewLaunch): string[] {
  switch (kind) {
    case 'claude': {
      if (!context.socket) throw new Error('Claude review requires the private Unix socket');
      return [
      '-p', '--output-format', 'text', '--permission-mode', 'dontAsk',
      '--settings', JSON.stringify({
        permissions: { allow: ['Read', 'Glob', 'Grep', 'Skill', 'Task', `Bash(${context.command} *)`, 'Bash(git show *)', 'Bash(git diff *)', 'Bash(git grep *)', 'Bash(git log *)'], deny: ['Edit', 'Write', 'NotebookEdit'] },
        sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, filesystem: { denyWrite: [context.repository] }, network: { allowUnixSockets: [context.socket] } },
      }),
      ];
    }
    case 'codex': {
      if (!context.url || new URL(context.url).hostname !== '127.0.0.1') throw new Error('Codex review requires the loopback channel');
      return [
      'exec', '--ignore-user-config', '--strict-config', '--json',
      '-c', 'default_permissions="criever_review"',
      '-c', 'permissions.criever_review.extends=":read-only"',
      '-c', 'permissions.criever_review.network.enabled=true',
      '-c', 'features.network_proxy=true',
      '-c', 'permissions.criever_review.network.domains={"127.0.0.1"="allow"}',
      '-',
      ];
    }
    case 'opencode': return ['run', '--agent', 'build', '--format', 'json'];
    default: return assertNever(kind);
  }
}

export function reviewEnvironment(command: string): Record<string, string> {
  return {
    OPENCODE_PERMISSION: JSON.stringify({
      edit: 'deny',
      bash: { '*': 'deny', 'git show *': 'allow', 'git diff *': 'allow', 'git grep *': 'allow', 'git log *': 'allow', 'git ls-tree *': 'allow', [`${command} *`]: 'allow' },
    }),
  };
}

function assertNever(value: never): never { throw new Error(`Unsupported review harness: ${String(value)}`); }
