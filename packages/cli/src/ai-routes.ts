import type { AiFinding, AiLookout, AiMessage, ReviewMeta } from '@criever/shared';
import { conversationPrompt, parseReviewResult, type AiRunner } from './ai';
import type { Git } from './git';
import type { StateStore } from './state';

interface AiRouteDeps { readonly adapter: AiRunner; readonly store: StateStore; readonly git: Git; readonly meta: ReviewMeta; readonly base: string }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export async function aiEndpoint(req: Request, path: string, deps: AiRouteDeps): Promise<Response | null> {
  if (req.method === 'GET' && path === '/api/ai') return json({ harnesses: deps.adapter.list(), conversation: await deps.store.loadAiConversation(), threads: await deps.store.loadAiThreads(), findings: await deps.store.loadAiFindings(), lookouts: await deps.store.loadAiLookouts(), reviewResult: deps.store.state.aiReviewResult ?? null, approvedIds: deps.store.state.approvedAiFindings ?? [] });
  const approval = /^\/api\/ai\/findings\/([^/]+)\/approve$/.exec(path);
  if (req.method === 'POST' && approval) {
    const draft = await deps.store.approveAiFinding(decodeURIComponent(approval[1] ?? ''), deps.meta.sourceHead);
    return draft ? json({ draft }) : json({ error: 'finding unavailable, stale, or already approved' }, 409);
  }
  const reword = /^\/api\/ai\/findings\/([^/]+)\/reword$/.exec(path);
  if (req.method === 'POST' && reword) return rewordFinding(req, decodeURIComponent(reword[1] ?? ''), deps);
  if (req.method === 'POST' && (path === '/api/ai/chat' || path === '/api/ai/review')) return postAi(req, path, deps);
  const match = /^\/api\/ai\/(findings|lookouts)\/([^/]+)$/.exec(path);
  if (match && (req.method === 'PATCH' || req.method === 'DELETE')) return mutateAiItem(req, match[1] ?? '', decodeURIComponent(match[2] ?? ''), deps);
  return null;
}

async function rewordFinding(req: Request, id: string, deps: AiRouteDeps): Promise<Response> {
  const finding = (await deps.store.loadAiFindings()).find(item => item.id === id);
  if (!finding) return json({ error: 'finding not found' }, 404);
  if (finding.anchorCommit !== deps.meta.sourceHead) return json({ error: 'finding is stale' }, 409);
  const body = await req.json().catch(() => null) as unknown;
  if (typeof body !== 'object' || body === null || !('harnessId' in body) || typeof body.harnessId !== 'string') return json({ error: 'harnessId required' }, 400);
  if (!deps.adapter.list().some(harness => harness.id === body.harnessId)) return json({ error: 'unknown harnessId' }, 400);
  const sourcePath = finding.side === 'old' ? await oldSidePath(finding.path, deps) : finding.path;
  const content = await deps.git.show(finding.side === 'old' ? deps.base : finding.anchorCommit, sourcePath);
  if (content === null) return json({ error: 'finding file no longer exists' }, 409);
  const context = content.split('\n').slice(Math.max(0, finding.line - 21), finding.line + 20).map((line, index) => `${Math.max(1, finding.line - 20) + index}: ${line}`).join('\n').slice(0, 20_000);
  const proposed = (await deps.adapter.run(body.harnessId, `Rewrite this code-review finding clearly and concisely without changing its meaning. Return only the revised finding text.\n${JSON.stringify({ finding: finding.body, path: finding.path, line: finding.line, side: finding.side, context })}`)).trim();
  if (!proposed || proposed.length > 10_000) return json({ error: 'reword response must be 1-10000 characters' }, 502);
  return json({ body: proposed });
}

async function postAi(req: Request, path: string, deps: AiRouteDeps): Promise<Response> {
  const body = await req.json().catch(() => null) as unknown;
  if (typeof body !== 'object' || body === null) return json({ error: 'request body required' }, 400);
  const input = body as Record<string, unknown>;
  if (typeof input.harnessId !== 'string') return json({ error: 'harnessId required' }, 400);
  if (!deps.adapter.list().some(harness => harness.id === input.harnessId)) return json({ error: 'unknown harnessId' }, 400);
  if (path === '/api/ai/chat') {
    if (typeof input.message !== 'string' || !input.message.trim()) return json({ error: 'message required' }, 400);
    const hasPath = input.path !== undefined; const hasLine = input.line !== undefined;
    if (hasLine && !hasPath) return json({ error: 'path required for a line question' }, 400);
    const context = hasPath ? await lineContext(input, deps) : `Repository diff ${deps.base}..${deps.meta.sourceHead}.`;
    if (context instanceof Response) return context;
    const threadId = typeof context === 'string' ? `general:${deps.meta.sourceHead}` : context.threadId;
    const promptContext = typeof context === 'string' ? context : context.prompt;
    const question: AiMessage = { role: 'user', content: input.message.trim() };
    const messages: AiMessage[] = [...(await deps.store.loadAiThreads())[threadId] ?? [], question];
    const answer = await deps.adapter.run(input.harnessId, conversationPrompt(messages, promptContext));
    const conversation = await deps.store.appendAiExchange(threadId, question, { role: 'assistant', content: answer });
    return json({ answer, threadId, conversation });
  }
  const diff = await deps.git.run(['diff', '--no-ext-diff', '--unified=0', deps.base, deps.meta.sourceHead]);
  const output = await deps.adapter.run(input.harnessId, `Analyze only the supplied patch for concrete code defects. Do not inspect the repository, invoke tools, or run a review workflow. Return a JSON object with findings and lookouts arrays. Finding entries require path, line, side (old or new), body, and severity (info, warning, or error). Lookouts are independent guidance, each requiring path, line, side, and body at a changed line.\n${diff.stdout}`, 'patch');
  const parsed = parseReviewResult(output);
  const anchors = changedLines(diff.stdout);
  const renames = new Map((await deps.git.changedFiles(deps.base, deps.meta.sourceHead)).flatMap(file => file.status === 'R' && file.oldPath && file.newPath ? [[file.oldPath, file.newPath] as const] : []));
  const findings: AiFinding[] = [];
  const lookouts: AiLookout[] = [];
  for (const item of parsed.findings) {
    if (!anchors.has(`${item.path}\0${item.side}\0${item.line}`)) continue;
    const id = crypto.randomUUID();
    findings.push({ ...item, path: renames.get(item.path) ?? item.path, id, anchorCommit: deps.meta.sourceHead });
  }
  for (const item of parsed.lookouts) {
    if (!anchors.has(`${item.path}\0${item.side}\0${item.line}`)) continue;
    lookouts.push({ ...item, path: renames.get(item.path) ?? item.path, id: crypto.randomUUID(), anchorCommit: deps.meta.sourceHead });
  }
  await deps.store.saveAiFindings(findings);
  await deps.store.saveAiLookouts(lookouts);
  const first = findings[0] ?? lookouts.find(item => item.path && item.side && item.line) ?? null;
  deps.store.state.aiReviewResult = { head: deps.meta.sourceHead, findings: findings.length, lookouts: lookouts.length, first: first?.path && first.side && first.line ? { path: first.path, side: first.side, line: first.line } : null };
  await deps.store.save();
  return json({ findings, lookouts });
}

async function lineContext(input: Record<string, unknown>, deps: AiRouteDeps): Promise<{ threadId: string; prompt: string } | Response> {
  if (typeof input.path !== 'string' || !input.path.trim() || (input.side !== undefined && input.side !== 'old' && input.side !== 'new')) return json({ error: 'valid path and optional side required' }, 400);
  const path = input.path;
  if (input.line === undefined) {
    if (input.side !== undefined) return json({ error: 'side requires a line' }, 400);
    const content = await deps.git.show(deps.meta.sourceHead, path);
    if (content === null) return json({ error: 'file not found at review head' }, 404);
    return { threadId: `file:${encodeURIComponent(path)}:${deps.meta.sourceHead}`, prompt: `Repository diff ${deps.base}..${deps.meta.sourceHead}; file ${path} at ${deps.meta.sourceHead}.\n${content.slice(0, 20_000)}` };
  }
  if (!Number.isInteger(input.line) || Number(input.line) < 1) return json({ error: 'valid line required' }, 400);
  const line = Number(input.line);
  const side = input.side === 'old' ? 'old' : 'new';
  const anchorCommit = side === 'old' ? deps.base : deps.meta.sourceHead;
  const content = await deps.git.show(anchorCommit, side === 'old' ? await oldSidePath(path, deps) : path);
  if (content === null) return json({ error: `file not found at ${side} review revision` }, 404);
  const lines = content.split('\n');
  if (line > lines.length) return json({ error: 'line outside file' }, 400);
  const start = Math.max(1, line - 20); const end = Math.min(lines.length, line + 20);
  const excerpt = lines.slice(start - 1, end).map((text, index) => `${start + index}: ${text}`).join('\n').slice(0, 20_000);
  return { threadId: `${path}:${side}:${line}:${anchorCommit}`, prompt: `Repository diff ${deps.base}..${deps.meta.sourceHead}; source ${path}:${line} on ${side} side at ${anchorCommit}.\n${excerpt}` };
}

async function oldSidePath(path: string, deps: AiRouteDeps): Promise<string> {
  return (await deps.git.changedFiles(deps.base, deps.meta.sourceHead)).find(file => file.status === 'R' && file.newPath === path)?.oldPath ?? path;
}

async function mutateAiItem(req: Request, collection: string, id: string, deps: AiRouteDeps): Promise<Response> {
  const findings = [...await deps.store.loadAiFindings()];
  const lookouts = [...await deps.store.loadAiLookouts()];
  const items = collection === 'findings' ? findings : lookouts;
  const index = items.findIndex(item => item.id === id);
  if (index < 0) return json({ error: 'item not found' }, 404);
  if (req.method === 'DELETE') {
    items.splice(index, 1);
    if (collection === 'findings') {
      await deps.store.saveAiFindings(findings);
      await deps.store.saveAiLookouts(lookouts.filter(item => item.findingId !== id));
    } else await deps.store.saveAiLookouts(lookouts);
    return json({ ok: true });
  }
  const body = await req.json().catch(() => null) as unknown;
  if (typeof body !== 'object' || body === null || !('body' in body) || typeof body.body !== 'string' || !body.body.trim()) return json({ error: 'body required' }, 400);
  if (collection === 'findings') {
    const current = findings.find(item => item.id === id);
    if (!current) return json({ error: 'item not found' }, 404);
    const edited = { ...current, body: body.body.trim() };
    findings.splice(index, 1, edited);
    await deps.store.saveAiFindings(findings);
    return json({ finding: edited });
  }
  const current = lookouts.find(item => item.id === id);
  if (!current) return json({ error: 'item not found' }, 404);
  const edited = { ...current, body: body.body.trim() };
  lookouts.splice(index, 1, edited);
  await deps.store.saveAiLookouts(lookouts);
  return json({ [collection === 'findings' ? 'finding' : 'lookout']: edited });
}

function changedLines(diff: string): Set<string> {
  const anchors = new Set<string>();
  let oldPath = ''; let newPath = '';
  let oldLine = 0; let newLine = 0;
  let inHunk = false;
  for (const entry of diff.split('\n')) {
    if (entry.startsWith('diff --git ')) { oldPath = ''; newPath = ''; inHunk = false; continue; }
    if (!inHunk && entry.startsWith('--- a/')) { oldPath = entry.slice(6); continue; }
    if (!inHunk && entry.startsWith('+++ b/')) { newPath = entry.slice(6); continue; }
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(entry);
    if (header) { oldLine = Number(header[1]); newLine = Number(header[2]); inHunk = true; continue; }
    if (inHunk && entry.startsWith('+')) { anchors.add(`${newPath}\0new\0${newLine++}`); continue; }
    if (inHunk && entry.startsWith('-')) { anchors.add(`${oldPath}\0old\0${oldLine}`); if (newPath) anchors.add(`${newPath}\0old\0${oldLine}`); oldLine++; continue; }
    if (inHunk && entry.startsWith(' ')) { oldLine++; newLine++; }
  }
  return anchors;
}
