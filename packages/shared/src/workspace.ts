export interface WorkspacePullRequest {
  readonly id: number;
  readonly title: string;
  readonly url: string;
  readonly author: string;
  readonly sourceBranch: string;
  readonly destinationBranch: string;
  readonly sourceHead: string;
  readonly destinationHead: string;
  readonly assignedToMe: boolean;
  readonly draft: boolean;
  readonly updatedAt: string;
  readonly reviewedHead: string | null;
  readonly reviewedAt: string | null;
  readonly status: 'unreviewed' | 'reviewed' | 'updated';
}

export interface WorkspaceProject {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly provider: 'github' | 'bitbucket';
  readonly owner: string;
  readonly repo: string;
  readonly pullRequests: readonly WorkspacePullRequest[];
  readonly refreshedAt: string | null;
  readonly error: string | null;
}

export interface WorkspaceSnapshot {
  readonly projects: readonly WorkspaceProject[];
  readonly pollIntervalMs: number;
}

export interface WorkspaceSession {
  readonly id: string;
  readonly projectId: string;
  readonly prId: number;
  readonly sourceHead: string;
  readonly title: string;
  readonly url: string;
}
