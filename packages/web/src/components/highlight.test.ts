import { describe, it, expect } from 'vitest';
import { highlightLine, languageFor } from './highlight';
describe('highlight', () => {
  it('maps extensions', () => {
    expect(languageFor('a.tsx')).toBe('typescript'); expect(languageFor('b.json')).toBe('json'); expect(languageFor('c.unknownext')).toBeNull();
  });
  it('escapes unknown languages', () => expect(highlightLine('<b>&', 'x.unknownext')).toBe('&lt;b&gt;&amp;'));
  it('wraps keywords for typescript', () => expect(highlightLine('const a = 1;', 'a.ts')).toMatch(/<span class="hljs-keyword">const<\/span>/));
});
