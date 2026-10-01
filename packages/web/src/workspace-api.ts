import type { WorkspaceFolders, WorkspaceProject, WorkspaceSession, WorkspaceSnapshot } from '@criever/shared';
import { useQuery } from '@tanstack/react-query';

export class WorkspaceApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/workspace${path}`, {
    ...init, headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error : response.statusText || `Request failed (${response.status})`;
    throw new WorkspaceApiError(response.status, message);
  }
  return response.json();
}
const projectPath = (id: string) => `/projects/${encodeURIComponent(id)}`;
const post = (body?: object): RequestInit => ({ method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });

export const workspaceApi = {
  folders: (path: string) => request<WorkspaceFolders>(`/folders?${new URLSearchParams({ path })}`),
  async snapshot(): Promise<WorkspaceSnapshot | null> {
    try { return await request<WorkspaceSnapshot>(''); }
    catch (error) { if (error instanceof WorkspaceApiError && error.status === 404) return null; throw error; }
  },
  session: (id: string) => request<WorkspaceSession>(`/sessions/${encodeURIComponent(id)}`),
  add: (path: string) => request<WorkspaceProject>('/projects', post({ path })),
  remove: (id: string) => request<{ ok: true }>(projectPath(id), { method: 'DELETE' }),
  refresh: () => request<WorkspaceSnapshot>('/refresh', post()),
  refreshProject: (id: string) => request<WorkspaceProject>(`${projectPath(id)}/refresh`, post()),
  reviewed: (id: string, number: number, sourceHead: string | null) =>
    request<WorkspaceProject>(`${projectPath(id)}/prs/${number}/reviewed`, post({ sourceHead })),
  checkout: (id: string, number: number) =>
    request<WorkspaceSession>(`${projectPath(id)}/prs/${number}/checkout`, post({ confirmed: true })),
};

export const workspaceKey = ['workspace'] as const;
export const useWorkspace = () => useQuery({
  queryKey: workspaceKey, queryFn: workspaceApi.snapshot,
  refetchInterval: query => query.state.data?.pollIntervalMs || false,
  refetchOnWindowFocus: false,
});
export const projectHref = (id: string) => `/projects/${encodeURIComponent(id)}`;
