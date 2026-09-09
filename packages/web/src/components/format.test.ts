import { describe, expect, it } from 'vitest';
import { applyFormat } from './format';

describe('applyFormat', () => {

  it('codeblock with no selection opens an empty fence instead of swallowing the text', () => {
    const r = applyFormat('needs a guard here', 18, 18, 'codeblock');
    expect(r.value).toBe('needs a guard here\n```\n\n```');
    expect(r.selStart).toBe(r.selEnd);
    expect(r.value.slice(r.selStart)).toBe('\n```');   // caret sits on the empty line inside the fence
  });

  it('codeblock with a selection still wraps the selected lines', () => {
    const r = applyFormat('a\nb\nc', 2, 3, 'codeblock');
    expect(r.value).toBe('a\n```\nb\n```\nc');
  });
  it('wraps with no selection and places the caret between the markers', () => {
    const r = applyFormat('', 0, 0, 'bold');
    expect(r.value).toBe('****');
    expect(r.selStart).toBe(2);
    expect(r.selEnd).toBe(2);
  });

  it('wraps a selection and keeps the selection over the formatted text', () => {
    const r = applyFormat('hello world', 0, 5, 'bold');
    expect(r.value).toBe('**hello** world');
    expect(r.selStart).toBe(2);
    expect(r.selEnd).toBe(7);
    expect(r.value.slice(r.selStart, r.selEnd)).toBe('hello');
  });

  it('applying bold twice returns the original string (toggle off)', () => {
    const r1 = applyFormat('hello world', 0, 5, 'bold');
    const r2 = applyFormat(r1.value, r1.selStart, r1.selEnd, 'bold');
    expect(r2.value).toBe('hello world');
    expect(r2.selStart).toBe(0);
    expect(r2.selEnd).toBe(5);
  });

  it('toggles italic and inline code off the same way', () => {
    const i1 = applyFormat('hi', 0, 2, 'italic');
    const i2 = applyFormat(i1.value, i1.selStart, i1.selEnd, 'italic');
    expect(i2.value).toBe('hi');
    const c1 = applyFormat('hi', 0, 2, 'code');
    const c2 = applyFormat(c1.value, c1.selStart, c1.selEnd, 'code');
    expect(c2.value).toBe('hi');
  });

  it('quote prefixes every line covering a multi-line selection, leaving other lines alone', () => {
    const r = applyFormat('one\ntwo\nthree', 1, 5, 'quote');
    expect(r.value).toBe('> one\n> two\nthree');
  });

  it('code block puts fences on their own lines around the selected line(s)', () => {
    const r = applyFormat('const x = 1;', 0, 13, 'codeblock');
    expect(r.value).toBe('```\nconst x = 1;\n```');
    expect(r.value.slice(r.selStart, r.selEnd)).toBe('const x = 1;');
  });

  it('link with a selection puts the text in the label and the caret in the url slot', () => {
    const r = applyFormat('see docs', 4, 8, 'link');
    expect(r.value).toBe('see [docs]()');
    expect(r.selStart).toBe(r.selEnd);
    expect(r.value.slice(0, r.selStart)).toBe('see [docs](');
  });

  it('link with no selection places the caret in the label slot', () => {
    const r = applyFormat('', 0, 0, 'link');
    expect(r.value).toBe('[]()');
    expect(r.selStart).toBe(1);
    expect(r.selEnd).toBe(1);
  });
});
