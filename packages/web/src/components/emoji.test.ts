import { describe, expect, it } from 'vitest';
import { emojify } from './emoji';

describe('emojify', () => {
  it('converts a known shortcode to its emoji, e.g. for a rail one-line preview', () => {
    expect(emojify('nice work :thumbsup:')).toBe('nice work 👍');
  });

  it('leaves an unknown shortcode unchanged', () => {
    expect(emojify('good :notarealemoji: idea')).toBe('good :notarealemoji: idea');
  });

  it('does not convert a shortcode inside a fenced code block', () => {
    const src = 'see below\n```\n:thumbsup:\n```';
    expect(emojify(src)).toBe(src);
  });

  it('does not convert a shortcode inside an inline code span', () => {
    const src = 'the `:thumbsup:` selector';
    expect(emojify(src)).toBe(src);
  });
});
