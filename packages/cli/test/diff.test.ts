import { describe, it, expect } from 'vitest';
import { parseHunkHeader, parseUnifiedDiff } from '../src/diff';

describe('parseHunkHeader', () => {
  it.each([
    ['@@ -36,9 +38,13 @@ export function X', { oldStart: 36, oldLen: 9, newStart: 38, newLen: 13, header: 'export function X' }],
    ['@@ -1 +1 @@', { oldStart: 1, oldLen: 1, newStart: 1, newLen: 1, header: '' }],
    ['@@ -0,0 +1,38 @@', { oldStart: 0, oldLen: 0, newStart: 1, newLen: 38, header: '' }],
    ['@@ -10,3 +9,0 @@', { oldStart: 10, oldLen: 3, newStart: 9, newLen: 0, header: '' }],
  ])('%s', (line, expected) => expect(parseHunkHeader(line)).toEqual(expected));
  it('returns null for non-headers', () => expect(parseHunkHeader('+foo')).toBeNull());
});

const MODIFIED = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,4 @@ top
 import x from 'x';
-const a = 1;
+const a = 2;
+const b = 3;
 export {};
-// end
`;

const RENAMED = `diff --git a/old.ts b/new.ts
similarity index 90%
rename from old.ts
rename to new.ts
index 1111111..2222222 100644
--- a/old.ts
+++ b/new.ts
@@ -1 +1 @@
-a
+b
`;

const ADDED = `diff --git a/n.ts b/n.ts
new file mode 100644
index 0000000..2222222
--- /dev/null
+++ b/n.ts
@@ -0,0 +1,2 @@
+one
+two
`;

const DELETED = `diff --git a/d.ts b/d.ts
deleted file mode 100644
index 1111111..0000000
--- a/d.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-one
-two
`;

const BINARY = `diff --git a/img.png b/img.png
index 1111111..2222222 100644
Binary files a/img.png and b/img.png differ
`;

describe('parseUnifiedDiff', () => {
  it('parses a modified file with line numbers on both sides', () => {
    const [f] = parseUnifiedDiff(MODIFIED);
    expect(f).toMatchObject({ oldPath: 'src/a.ts', newPath: 'src/a.ts', status: 'M', additions: 2, deletions: 2, binary: false });
    expect(f!.hunks).toHaveLength(1);
    expect(f!.hunks[0]!.header).toBe('top');
    expect(f!.hunks[0]!.lines).toEqual([
      { kind: 'context', oldNo: 1, newNo: 1, text: "import x from 'x';" },
      { kind: 'del', oldNo: 2, newNo: null, text: 'const a = 1;' },
      { kind: 'add', oldNo: null, newNo: 2, text: 'const a = 2;' },
      { kind: 'add', oldNo: null, newNo: 3, text: 'const b = 3;' },
      { kind: 'context', oldNo: 3, newNo: 4, text: 'export {};' },
      { kind: 'del', oldNo: 4, newNo: null, text: '// end' },
    ]);
  });
  it('detects rename', () => {
    const [f] = parseUnifiedDiff(RENAMED);
    expect(f).toMatchObject({ oldPath: 'old.ts', newPath: 'new.ts', status: 'R' });
  });
  it('detects added and deleted files', () => {
    expect(parseUnifiedDiff(ADDED)[0]).toMatchObject({ oldPath: null, newPath: 'n.ts', status: 'A', additions: 2 });
    expect(parseUnifiedDiff(DELETED)[0]).toMatchObject({ oldPath: 'd.ts', newPath: null, status: 'D', deletions: 2 });
  });
  it('flags binary files', () => {
    expect(parseUnifiedDiff(BINARY)[0]).toMatchObject({ binary: true, hunks: [] });
  });
  it('splits multiple files', () => {
    expect(parseUnifiedDiff(MODIFIED + RENAMED + ADDED)).toHaveLength(3);
  });
  it('handles "\\ No newline at end of file"', () => {
    const t = MODIFIED.replace('-// end\n', '-// end\n\\ No newline at end of file\n');
    expect(parseUnifiedDiff(t)[0]!.hunks[0]!.lines).toHaveLength(6);
  });
  it('returns [] for empty input', () => expect(parseUnifiedDiff('')).toEqual([]));
});
