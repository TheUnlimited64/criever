import type { DiffLine, FileDiff, Hunk } from '@criever/shared';

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

export function parseHunkHeader(line: string): Omit<Hunk, 'lines'> | null {
  const m = HUNK.exec(line);
  if (!m) return null;
  return {
    oldStart: +m[1]!, oldLen: m[2] === undefined ? 1 : +m[2],
    newStart: +m[3]!, newLen: m[4] === undefined ? 1 : +m[4],
    header: m[5] ?? '',
  };
}

function decodeGitPath(raw: string): string {
  const header = raw.replace(/\t$/, '');
  const path = header.startsWith('"') && header.endsWith('"') ? header.slice(1, -1) : header;
  if (!header.startsWith('"')) return path;
  const bytes: number[] = [];
  for (let index = 0; index < path.length; index++) {
    const character = path.charAt(index);
    if (character !== '\\') {
      const point = path.codePointAt(index);
      if (point !== undefined) { bytes.push(...Buffer.from(String.fromCodePoint(point))); if (point > 0xffff) index++; }
      continue;
    }
    const next = path.charAt(++index);
    const octal = /^[0-7]{3}/.exec(path.slice(index))?.[0];
    if (octal) { bytes.push(Number.parseInt(octal, 8)); index += 2; continue; }
    switch (next) {
      case 't': bytes.push(9); break;
      case 'n': bytes.push(10); break;
      case 'r': bytes.push(13); break;
      case 'b': bytes.push(8); break;
      case 'f': bytes.push(12); break;
      case 'v': bytes.push(11); break;
      default: bytes.push(...Buffer.from(next));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function stripPrefix(raw: string): string | null {
  const path = decodeGitPath(raw);
  if (path === '/dev/null') return null;
  return path.replace(/^[ab]\//, '');
}

export function parseUnifiedDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let f: FileDiff | null = null;
  let h: Hunk | null = null;
  let oldNo = 0, newNo = 0;
  let renamed = false;

  for (const raw of text.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(raw);
      const quoted = /^diff --git ("(?:\\.|[^"\\])*") ("(?:\\.|[^"\\])*")$/.exec(raw);
      f = { oldPath: m?.[1] ?? (quoted?.[1] ? stripPrefix(quoted[1]) : null), newPath: m?.[2] ?? (quoted?.[2] ? stripPrefix(quoted[2]) : null), status: 'M', hunks: [], additions: 0, deletions: 0, binary: false };
      files.push(f); h = null; renamed = false;
      continue;
    }
    if (!f) continue;
    if (raw.startsWith('rename from ')) { renamed = true; f.oldPath = decodeGitPath(raw.slice(12)); f.status = 'R'; continue; }
    if (raw.startsWith('rename to ')) { f.newPath = decodeGitPath(raw.slice(10)); continue; }
    if (raw.startsWith('new file mode')) { f.status = 'A'; f.oldPath = null; continue; }
    if (raw.startsWith('deleted file mode')) { f.status = 'D'; f.newPath = null; continue; }
    if (raw.startsWith('Binary files')) { f.binary = true; continue; }
    if (!h && raw.startsWith('--- ')) { if (!renamed) f.oldPath = stripPrefix(raw.slice(4)); continue; }
    if (!h && raw.startsWith('+++ ')) { if (!renamed) f.newPath = stripPrefix(raw.slice(4)); continue; }
    if (raw.startsWith('\\ ')) continue; // "\ No newline at end of file"

    const hh = parseHunkHeader(raw);
    if (hh) { h = { ...hh, lines: [] }; f.hunks.push(h); oldNo = hh.oldStart; newNo = hh.newStart; continue; }
    if (!h) continue;

    const c = raw[0], t = raw.slice(1);
    let line: DiffLine;
    if (c === '+') { line = { kind: 'add', oldNo: null, newNo: newNo++, text: t }; f.additions++; }
    else if (c === '-') { line = { kind: 'del', oldNo: oldNo++, newNo: null, text: t }; f.deletions++; }
    else if (c === ' ') { line = { kind: 'context', oldNo: oldNo++, newNo: newNo++, text: t }; }
    else continue; // trailing empty line
    h.lines.push(line);
  }
  return files;
}
