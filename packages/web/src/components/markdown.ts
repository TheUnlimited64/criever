import { Marked, marked } from 'marked';
import type { PrInfo } from '@criever/shared';
import { emojify } from './emoji';

export type MarkdownFlavor = 'gfm' | 'bitbucket';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Bitbucket Cloud comments run Python-Markdown with exactly: codehilite, tables, def_list, del,
// footnotes, headerid, sane_lists, abbr, fenced_code, toc, wikilinks — no bare-URL autolinking
// extension, so disable marked's GFM url tokenizer for this flavour. Tables/del/fenced-code stay
// on (marked's `gfm: true`) since Bitbucket's own list covers those.
const bitbucketRenderer = new Marked({ gfm: true, breaks: false }).use({ tokenizer: { url: () => undefined } });

// `sane_lists` (Bitbucket's list extension) has no task-list support, so "- [ ] x" renders as
// literal "[ ] x" text there, not a checkbox. Escaping the brackets stops marked's GFM task-list
// detection (which only matches an *unescaped* "[ ] "/"[x] " prefix) from firing; marked's own
// backslash-unescaping then turns "\[ \]" back into literal "[ ]" in the rendered text.
function escapeTaskLists(s: string): string {
  return s.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](?=\s)/gm, '$1\\[$2\\]');
}

// Local approximation of a provider's markdown rendering, not the same renderer the provider uses
// to publish comments. Raw HTML is escaped first: for `bitbucket` this now matches Bitbucket's
// documented behaviour exactly (its docs state arbitrary HTML is not supported in Markdown), and
// for `gfm` it remains a safety measure — either way edge cases can still differ from the original.
export function renderMarkdown(source: string, flavor: MarkdownFlavor = 'gfm'): string {
  if (!source) return '';
  const escaped = escapeHtml(emojify(source));
  if (flavor === 'bitbucket') return bitbucketRenderer.parse(escapeTaskLists(escaped), { async: false }) as string;
  return marked.parse(escaped, { async: false }) as string;
}

const TASK_LIST_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\](?=\s)/m;

// Constructs whose rendering differs from what the target provider will actually show, so we warn
// instead of silently rewriting the user's text. Only 'bitbucket' has a documented gap today (no
// task-list extension in its Python-Markdown config); add more entries here as they're found.
export function markdownWarnings(source: string, flavor: MarkdownFlavor): string[] {
  if (flavor !== 'bitbucket') return [];
  const warnings: string[] = [];
  if (TASK_LIST_RE.test(source)) warnings.push('Task list ("- [ ] …") will show as literal "[ ]" text on Bitbucket — it has no task-list extension.');
  return warnings;
}

export function flavorForProviderKind(kind: PrInfo['kind']): MarkdownFlavor {
  return kind === 'bitbucket' ? 'bitbucket' : 'gfm';
}
