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

function stripPrefix(p: string): string | null {
  if (p === '/dev/null') return null;
  return p.replace(/^[ab]\//, '');
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
      f = { oldPath: m?.[1] ?? null, newPath: m?.[2] ?? null, status: 'M', hunks: [], additions: 0, deletions: 0, binary: false };
      files.push(f); h = null; renamed = false;
      continue;
    }
    if (!f) continue;
    if (raw.startsWith('rename from ')) { renamed = true; f.oldPath = raw.slice(12); f.status = 'R'; continue; }
    if (raw.startsWith('rename to ')) { f.newPath = raw.slice(10); continue; }
    if (raw.startsWith('new file mode')) { f.status = 'A'; f.oldPath = null; continue; }
    if (raw.startsWith('deleted file mode')) { f.status = 'D'; f.newPath = null; continue; }
    if (raw.startsWith('Binary files')) { f.binary = true; continue; }
    if (raw.startsWith('--- ')) { if (!renamed) f.oldPath = stripPrefix(raw.slice(4)); continue; }
    if (raw.startsWith('+++ ')) { if (!renamed) f.newPath = stripPrefix(raw.slice(4)); continue; }
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
