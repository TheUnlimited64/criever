import type { LegacyHarnessKind } from './config';

export interface ReviewLaunch {
  readonly command: string;
  readonly url: string;
  readonly repository: string;
}

export function reviewArgs(kind: LegacyHarnessKind, context: ReviewLaunch): string[] {
  if (new URL(context.url).hostname !== '127.0.0.1') throw new Error(`${kind} review requires the loopback channel`);
  switch (kind) {
    case 'claude': {
      return [
      '-p', '--output-format', 'text', '--permission-mode', 'dontAsk',
      '--settings', JSON.stringify({
        permissions: { allow: ['Read', 'Glob', 'Grep', 'Skill', 'Task', 'Bash'], deny: ['Edit', 'Write', 'NotebookEdit'] },
        sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, filesystem: { denyWrite: [`${context.repository}/.git`] }, network: { allowedDomains: ['127.0.0.1', '*'] } },
      }),
      ];
    }
    case 'codex': {
      return [
      'exec', '--ignore-user-config', '--strict-config', '--json',
      '-c', 'default_permissions="criever_review"',
      '-c', 'permissions.criever_review.extends=":workspace"',
      '-c', 'permissions.criever_review.network.enabled=true',
      '-c', 'features.network_proxy=true',
      '-c', 'permissions.criever_review.network.domains={"127.0.0.1"="allow","*"="allow"}',
      '-',
      ];
    }
    case 'opencode': return ['run', '--agent', 'build', '--format', 'json'];
    default: return assertNever(kind);
  }
}

export function reviewEnvironment(): Record<string, string> {
  return {
    OPENCODE_PERMISSION: JSON.stringify({
      edit: 'deny',
      bash: { '*': 'allow' },
    }),
  };
}

function assertNever(value: never): never { throw new Error(`Unsupported review harness: ${String(value)}`); }
