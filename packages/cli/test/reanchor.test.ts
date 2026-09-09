import { describe, it, expect } from 'vitest';
import { reanchor } from '../src/reanchor';
import type { Hunk } from '@criever/shared';

const H = (oldStart: number, oldLen: number, newStart: number, newLen: number): Hunk =>
  ({ oldStart, oldLen, newStart, newLen, header: '', lines: [] });

describe('reanchor', () => {
  it('no hunks → same', () => expect(reanchor(10, [])).toEqual({ status: 'same' }));
  it('line before the only hunk → same', () => expect(reanchor(5, [H(10, 2, 10, 3)])).toEqual({ status: 'same' }));
  it('line after a growing hunk → moved by delta', () =>
    expect(reanchor(20, [H(10, 2, 10, 5)])).toEqual({ status: 'moved', newLine: 23 }));
  it('line after a shrinking hunk → moved up', () =>
    expect(reanchor(20, [H(10, 5, 10, 2)])).toEqual({ status: 'moved', newLine: 17 }));
  it('line after a same-size hunk → same', () => expect(reanchor(20, [H(10, 2, 10, 2)])).toEqual({ status: 'same' }));
  it('line inside a hunk → changed at newStart', () => {
    const h = H(10, 3, 12, 4);
    expect(reanchor(11, [h])).toEqual({ status: 'changed', newLine: 12, hunk: h });
  });
  it('line at first line of hunk → changed', () => expect(reanchor(10, [H(10, 3, 10, 3)]).status).toBe('changed'));
  it('line at last line of hunk → changed', () => expect(reanchor(12, [H(10, 3, 10, 3)]).status).toBe('changed'));
  it('line just after hunk → not changed', () => expect(reanchor(13, [H(10, 3, 10, 3)]).status).toBe('same'));
  it('line inside a pure deletion → deleted with nearestLine', () =>
    expect(reanchor(11, [H(10, 3, 9, 0)])).toEqual({ status: 'deleted', nearestLine: 9 }));
  it('deletion at file start → nearestLine 1', () =>
    expect(reanchor(1, [H(1, 3, 0, 0)])).toEqual({ status: 'deleted', nearestLine: 1 }));
  it('pure insertion after the line leaves it in place', () =>
    expect(reanchor(10, [H(10, 0, 11, 4)])).toEqual({ status: 'same' }));
  it('pure insertion before the line shifts it', () =>
    expect(reanchor(10, [H(5, 0, 6, 4)])).toEqual({ status: 'moved', newLine: 14 }));
  it('accumulates offsets over multiple hunks', () =>
    expect(reanchor(50, [H(10, 2, 10, 5), H(20, 4, 23, 2), H(60, 1, 58, 1)])).toEqual({ status: 'moved', newLine: 51 }));
  it('changed in a later hunk after earlier offsets', () => {
    const h2 = H(20, 4, 23, 1);
    expect(reanchor(21, [H(10, 2, 10, 5), h2])).toEqual({ status: 'changed', newLine: 23, hunk: h2 });
  });
});
