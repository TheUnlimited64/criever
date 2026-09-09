import hljs from 'highlight.js/lib/core';
import ts from 'highlight.js/lib/languages/typescript';
import js from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import scss from 'highlight.js/lib/languages/scss';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import md from 'highlight.js/lib/languages/markdown';
import bash from 'highlight.js/lib/languages/bash';
import java from 'highlight.js/lib/languages/java';
import kotlin from 'highlight.js/lib/languages/kotlin';
import python from 'highlight.js/lib/languages/python';
for (const [n, l] of Object.entries({ typescript: ts, javascript: js, json, css, scss, xml, yaml, markdown: md, bash, java, kotlin, python })) hljs.registerLanguage(n, l);

const EXT: Record<string, string> = { ts: 'typescript', tsx: 'typescript', mts: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', json: 'json', css: 'css', scss: 'scss', html: 'xml', xml: 'xml', svg: 'xml', yml: 'yaml', yaml: 'yaml', md: 'markdown', sh: 'bash', bash: 'bash', java: 'java', kt: 'kotlin', kts: 'kotlin', py: 'python' };
export const languageFor = (path: string): string | null => EXT[path.split('.').pop()?.toLowerCase() ?? ''] ?? null;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Per-line highlighting; multi-line comments/strings lose state across lines. Upgrade: hljs on the whole file, split by line.
export function highlightLine(text: string, path: string): string {
  const lang = languageFor(path); if (!lang) return esc(text);
  try { return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value; } catch { return esc(text); }
}
