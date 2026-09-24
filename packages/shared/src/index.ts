export type Side = 'old' | 'new';
export type FileStatus = 'A' | 'M' | 'D' | 'R';

export interface DiffLine { kind: 'context' | 'add' | 'del'; oldNo: number | null; newNo: number | null; text: string }
export interface Hunk { oldStart: number; oldLen: number; newStart: number; newLen: number; header: string; lines: DiffLine[] }
export interface FileDiff {
  oldPath: string | null; newPath: string | null; status: FileStatus;
  hunks: Hunk[]; additions: number; deletions: number; binary: boolean;
}

export interface Draft {
  id: string; path: string; line: number; side: Side; body: string;
  anchorCommit: string; parentId?: number; createdAt: string;
  // Set when this draft was carried over from a local review's comment rather than
  // written fresh in the composer — lets the server mark the source comment published once this
  // draft is, and lets the sheet show where the draft came from.
  sourceLocalId?: number; author?: 'me' | 'agent'; agentName?: string;
}
export interface Anchor { path: string; line: number; side: Side; anchorCommit: string; source: 'criever' | 'inferred' }
export interface PrState {
  drafts: Draft[];
  anchors: Record<number, Anchor>;
  viewed: Record<string, string>;
  lastSeenHead?: string;
  aiConversation?: AiMessage[];
  aiThreads?: Record<string, AiMessage[]>;
  aiFindings?: AiFinding[];
  aiLookouts?: AiLookout[];
  aiReviewResult?: AiReviewSummary;
  approvedAiFindings?: string[];
}

export interface AiMessage { readonly role: 'user' | 'assistant'; readonly content: string }
export interface AiFinding { readonly id: string; readonly path: string; readonly line: number; readonly side: Side; readonly body: string; readonly severity: 'info' | 'warning' | 'error'; readonly anchorCommit: string }
export interface AiLookout { readonly id: string; readonly body: string; readonly findingId?: string; readonly path?: string; readonly line?: number; readonly side?: Side; readonly anchorCommit?: string }
export interface AiReviewSummary { readonly head: string; readonly findings: number; readonly lookouts: number; readonly first: { readonly path: string; readonly side: Side; readonly line: number } | null }

export type AnchorStatus =
  | { status: 'same' }
  | { status: 'moved'; newLine: number }
  | { status: 'changed'; newLine: number; hunk: Hunk }
  | { status: 'deleted'; nearestLine: number }
  | { status: 'fileDeleted' };

export interface LocalComment {
  id: number;
  parentId: number | null;
  path: string | null;
  line: number | null;
  side: Side;
  body: string;
  author: 'me' | 'agent';
  agentName?: string;
  anchorCommit: string;
  resolved: boolean;
  createdAt: string;
  // Set once this comment has been carried over as a draft and published to a real PR, so a
  // later startup's carry-over doesn't offer it again.
  publishedTo?: { prId: number; commentId: number };
}
export interface LocalReview {
  version: 1;
  base: string;
  head: string;
  comments: LocalComment[];
  nextId: number;
}

export interface PrCommit { hash: string; date: string; message: string }
export interface PrInfo {
  id: number; title: string; url: string | null; author: string; description: string | null;
  kind: 'bitbucket' | 'local';
  sourceBranch: string; destinationBranch: string;
  sourceHead: string; destinationHead: string; mergeBase: string;
  commits: PrCommit[];
  lastSeenHead: string | null;
  localBehind: number;
  stateWarning: string | null;
}

// The neutral shape a Provider hands the server to build a PrInfo from, without the server
// knowing whether it came from Bitbucket's RawPr or a local review file.
export interface ReviewMeta {
  id: number; title: string; url: string | null; author: string; description: string | null;
  sourceBranch: string; sourceHead: string;
  destinationBranch: string; destinationHead: string;
}

export interface BbComment {
  id: number; parentId: number | null;
  author: { name: string; initials: string; isMe: boolean };
  createdOn: string; body: string; resolved: boolean; deleted: boolean;
  inline: { path: string; from: number | null; to: number | null } | null;
}
export interface Thread {
  root: BbComment; replies: BbComment[];
  anchor: Anchor | null; status: AnchorStatus | null;
  displayPath: string | null; displayLine: number | null; displaySide: Side;
}

export interface ChangedFile {
  path: string; oldPath: string | null; status: FileStatus;
  additions: number; deletions: number; viewed: boolean;
  draftCount: number; changedCount: number; openCount: number;
}
export interface TreeEntry { path: string }
export interface SearchHit { path: string; line: number; text: string }
export interface PublishResult { draftId: string; ok: boolean; commentId?: number; error?: string }
export interface CommentsResponse { threads: Thread[]; drafts: Draft[] }
export interface DiffResponse { file: FileDiff | null; base: string; head: string; context: number }
export interface VscodeOpenResponse { url: string }
