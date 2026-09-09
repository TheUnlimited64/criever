export type FormatKind = 'bold' | 'italic' | 'code' | 'codeblock' | 'link' | 'quote';

export interface FormatResult {
  value: string;
  selStart: number;
  selEnd: number;
}

const INLINE_MARKER: Record<'bold' | 'italic' | 'code', string> = { bold: '**', italic: '_', code: '`' };

function wrapInline(value: string, s: number, e: number, marker: string): FormatResult {
  const before = value.slice(Math.max(0, s - marker.length), s);
  const after = value.slice(e, e + marker.length);
  if (before === marker && after === marker) {
    const nv = value.slice(0, s - marker.length) + value.slice(s, e) + value.slice(e + marker.length);
    return { value: nv, selStart: s - marker.length, selEnd: e - marker.length };
  }
  const nv = value.slice(0, s) + marker + value.slice(s, e) + marker + value.slice(e);
  return { value: nv, selStart: s + marker.length, selEnd: e + marker.length };
}

// Line-oriented ops (quote, code block) expand the selection to cover whole lines first.
function lineBounds(value: string, s: number, e: number): { lineStart: number; lineEnd: number } {
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  const nl = value.indexOf('\n', e);
  return { lineStart, lineEnd: nl === -1 ? value.length : nl };
}

function wrapBlock(value: string, s: number, e: number): FormatResult {
  if (s === e) {
    // No selection: open an empty fence to type into. Wrapping the caret's whole line would turn a
    // paragraph you just typed into code, which is not what reaching for this button means.
    const atLineStart = s === 0 || value[s - 1] === '\n';
    const lead = atLineStart ? '' : '\n';
    const fenced = lead + '```\n\n```';
    const caret = s + lead.length + 4;
    return { value: value.slice(0, s) + fenced + value.slice(s), selStart: caret, selEnd: caret };
  }
  const { lineStart, lineEnd } = lineBounds(value, s, e);
  const content = value.slice(lineStart, lineEnd);
  const before = value.slice(0, lineStart);
  const after = value.slice(lineEnd);
  const fenced = '```\n' + content + '\n```';
  return { value: before + fenced + after, selStart: before.length + 4, selEnd: before.length + 4 + content.length };
}

function quoteLines(value: string, s: number, e: number): FormatResult {
  const { lineStart, lineEnd } = lineBounds(value, s, e);
  const content = value.slice(lineStart, lineEnd);
  const quoted = content.split('\n').map(l => `> ${l}`).join('\n');
  const before = value.slice(0, lineStart);
  const after = value.slice(lineEnd);
  return { value: before + quoted + after, selStart: before.length, selEnd: before.length + quoted.length };
}

function wrapLink(value: string, s: number, e: number): FormatResult {
  const label = value.slice(s, e);
  const before = value.slice(0, s);
  const after = value.slice(e);
  const nv = `${before}[${label}]()${after}`;
  if (s === e) return { value: nv, selStart: before.length + 1, selEnd: before.length + 1 };
  const urlPos = before.length + 1 + label.length + 2;
  return { value: nv, selStart: urlPos, selEnd: urlPos };
}

export function applyFormat(value: string, selStart: number, selEnd: number, kind: FormatKind): FormatResult {
  switch (kind) {
    case 'bold': case 'italic': case 'code': return wrapInline(value, selStart, selEnd, INLINE_MARKER[kind]);
    case 'codeblock': return wrapBlock(value, selStart, selEnd);
    case 'link': return wrapLink(value, selStart, selEnd);
    case 'quote': return quoteLines(value, selStart, selEnd);
  }
}
