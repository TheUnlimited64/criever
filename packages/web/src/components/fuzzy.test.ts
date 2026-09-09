import { describe, it, expect } from 'vitest';
import { fuzzyScore } from './fuzzy';
describe('fuzzyScore', () => {
  it('null when not a subsequence', () => expect(fuzzyScore('zz', 'src/a.ts')).toBeNull());
  it('prefers filename matches over directory matches', () => expect(fuzzyScore('devl', 'src/devices/DeviceList.tsx')!).toBeGreaterThan(fuzzyScore('devl', 'src/devl/other.ts')!));
  it('empty query matches everything with 0', () => expect(fuzzyScore('', 'x')).toBe(0));
  it('case-insensitive', () => expect(fuzzyScore('DL', 'devicelist.tsx')).not.toBeNull());
});
