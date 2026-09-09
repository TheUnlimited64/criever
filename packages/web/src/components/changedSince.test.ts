import { describe, it, expect } from 'vitest';
import { changedSinceChip, changedSinceHeading } from './changedSince';

describe('changedSinceChip', () => {
  it('names yourself', () => expect(changedSinceChip({ isMe: true, name: 'Alex Morgan' })).toBe('changed since your comment'));
  it("names a colleague", () => expect(changedSinceChip({ isMe: false, name: 'Sam Rivera' })).toBe("changed since Sam's comment"));
  it('handles a first name already ending in s', () => expect(changedSinceChip({ isMe: false, name: 'Atlas Example' })).toBe("changed since Atlas' comment"));
  it('falls back to a neutral phrase with no usable name', () => {
    expect(changedSinceChip({ isMe: false, name: '' })).toBe('changed since this comment');
    expect(changedSinceChip(null)).toBe('changed since this comment');
  });
});

describe('changedSinceHeading', () => {
  const t = (isMe: boolean, name: string) => ({ root: { author: { isMe, name } } });
  it('says "your" when every thread in the group is mine', () => expect(changedSinceHeading([t(true, 'Alex Morgan'), t(true, 'Alex Morgan')])).toBe('Changed since your comment'));
  it('names the one colleague when the whole group is theirs', () => expect(changedSinceHeading([t(false, 'Sam Rivera'), t(false, 'Sam Rivera')])).toBe("Changed since Sam's comment"));
  it('falls back to a neutral plural for a mixed-author group', () => expect(changedSinceHeading([t(true, 'Alex Morgan'), t(false, 'Sam Rivera')])).toBe('Changed since these comments'));
  it('defaults to "your" for an empty group', () => expect(changedSinceHeading([])).toBe('Changed since your comment'));
});
