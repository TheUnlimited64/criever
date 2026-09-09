import { describe, expect, it } from 'vitest';
import { markdownWarnings, renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders bold', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
  });

  it('renders a fenced code block', () => {
    const html = renderMarkdown('```\nconst x = 1;\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('<code>');
  });

  it('renders a list', () => {
    const html = renderMarkdown('- item one\n- item two');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>item one</li>');
  });

  it('escapes raw HTML so it renders as literal text, not an executable element', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toMatch(/<script>/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('returns empty output for empty input', () => {
    expect(renderMarkdown('')).toBe('');
  });

  it('unescapes a backslash-escaped paren, as sent by Bitbucket comment storage', () => {
    const html = renderMarkdown('some text \\(some more text\\)', 'bitbucket');
    expect(html).toContain('some text (some more text)');
    expect(html).not.toContain('\\(');
  });

  it('produces the same visible text for plain prose with no markdown constructs', () => {
    const html = renderMarkdown('just a plain comment, nothing fancy here');
    expect(html.replace(/<[^>]+>/g, '').trim()).toBe('just a plain comment, nothing fancy here');
  });

  it('renders a task list as checkboxes under gfm', () => {
    const html = renderMarkdown('- [ ] thing', 'gfm');
    expect(html).toContain('<input');
    expect(html).toContain('type="checkbox"');
  });

  it('renders a task list as literal text under bitbucket flavour (no task-list extension)', () => {
    const html = renderMarkdown('- [ ] thing', 'bitbucket');
    expect(html).not.toContain('<input');
    expect(html).toContain('[ ] thing');
  });

  it('does not auto-link a bare URL under bitbucket flavour', () => {
    const html = renderMarkdown('see https://example.com for more', 'bitbucket');
    expect(html).not.toContain('<a href');
    expect(html).toContain('https://example.com');
  });

  it('still escapes raw HTML under bitbucket flavour', () => {
    const html = renderMarkdown('<script>alert(1)</script>', 'bitbucket');
    expect(html).not.toMatch(/<script>/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('renderMarkdown emoji shortcodes', () => {
  it('converts a known emoji shortcode to its emoji character', () => {
    const html = renderMarkdown('nice work :thumbsup:');
    expect(html).toContain('👍');
    expect(html).not.toContain(':thumbsup:');
  });

  it('does not convert a shortcode-like token inside a fenced code block', () => {
    const html = renderMarkdown('```\n:thumbsup:\n```');
    expect(html).toContain(':thumbsup:');
    expect(html).not.toContain('👍');
  });

  it('does not convert a shortcode-like token inside an inline code span', () => {
    const html = renderMarkdown('the `:thumbsup:` code');
    expect(html).toContain(':thumbsup:');
    expect(html).not.toContain('👍');
  });

  it('leaves an unknown shortcode unchanged', () => {
    const html = renderMarkdown(':notarealemoji: thing');
    expect(html).toContain(':notarealemoji:');
  });
});

describe('markdownWarnings', () => {
  it('flags a task list under bitbucket flavour', () => {
    const warnings = markdownWarnings('- [ ] thing', 'bitbucket');
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/task list/i);
  });

  it('reports nothing for a comment with no unsupported constructs', () => {
    expect(markdownWarnings('just plain text with a *word*', 'bitbucket')).toEqual([]);
  });

  it('reports nothing under gfm flavour, since gfm is the renderer being used', () => {
    expect(markdownWarnings('- [ ] thing', 'gfm')).toEqual([]);
  });
});
