import { describe, it, expect } from 'vitest';
import { matchKey } from './keys';
const k = (key: string, o: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; tag: string }> = {}) =>
  matchKey({ key, metaKey: !!o.metaKey, ctrlKey: !!o.ctrlKey, shiftKey: !!o.shiftKey, altKey: !!o.altKey, target: { tagName: o.tag ?? 'DIV' } });
describe('matchKey', () => {
  it('maps plain keys', () => { expect(k('j')).toBe('nextHunk'); expect(k('k')).toBe('prevHunk'); expect(k('n')).toBe('nextThread'); expect(k('c')).toBe('comment'); expect(k('v')).toBe('viewed'); expect(k('.')).toBe('vscode'); expect(k('?', { shiftKey: true })).toBe('keys'); expect(k(']')).toBe('nextFile'); expect(k('u')).toBe('split'); expect(k('r')).toBe('resolve'); expect(k('o')).toBe('overview'); });
  it('maps ArrowDown/ArrowUp to line movement', () => { expect(k('ArrowDown')).toBe('nextLine'); expect(k('ArrowUp')).toBe('prevLine'); });
  it('ignores arrows inside inputs/selects', () => { expect(k('ArrowDown', { tag: 'INPUT' })).toBeNull(); expect(k('ArrowUp', { tag: 'TEXTAREA' })).toBeNull(); expect(k('ArrowDown', { tag: 'SELECT' })).toBeNull(); });
  it('maps meta/ctrl combos on both platforms', () => { expect(k('k', { metaKey: true })).toBe('palette'); expect(k('k', { ctrlKey: true })).toBe('palette'); expect(k('F', { ctrlKey: true, shiftKey: true })).toBe('search'); expect(k('f', { metaKey: true })).toBe('find'); expect(k('Enter', { metaKey: true })).toBe('publish'); });
  it('ignores plain keys inside inputs but keeps escape and combos', () => { expect(k('j', { tag: 'TEXTAREA' })).toBeNull(); expect(k('Escape', { tag: 'INPUT' })).toBe('escape'); expect(k('k', { metaKey: true, tag: 'INPUT' })).toBe('palette'); });
  it('returns null for unknown', () => expect(k('z')).toBeNull());
});
