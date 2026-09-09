import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { StateStore, emptyState } from '../src/state';

let dir: string; let file: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'criever-state-')); file = StateStore.path(dir, 'ws', 'repo', 42); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('StateStore', () => {
  it('path layout', () => expect(file).toBe(join(dir, 'ws', 'repo', 'pr-42.json')));
  it('load on missing file yields empty state and no warning', async () => {
    const s = new StateStore(file); await s.load();
    expect(s.state).toEqual(emptyState()); expect(s.warning).toBeNull();
  });
  it('save creates directories and round-trips', async () => {
    const s = new StateStore(file); await s.load();
    const d = await s.addDraft({ path: 'a.ts', line: 3, side: 'new', body: 'hi', anchorCommit: 'abc' });
    expect(d.id).toMatch(/[0-9a-f-]{36}/); expect(d.createdAt).toMatch(/^\d{4}-/);
    const s2 = new StateStore(file); await s2.load();
    expect(s2.state.drafts).toEqual([d]);
    expect(existsSync(file + '.tmp')).toBe(false);
  });
  it('update/remove draft', async () => {
    const s = new StateStore(file); await s.load();
    const d = await s.addDraft({ path: 'a.ts', line: 3, side: 'new', body: 'hi', anchorCommit: 'abc' });
    expect((await s.updateDraft(d.id, 'edited'))!.body).toBe('edited');
    expect(await s.updateDraft('nope', 'x')).toBeNull();
    expect(await s.removeDraft(d.id)).toBe(true);
    expect(await s.removeDraft(d.id)).toBe(false);
  });
  it('anchors, viewed, lastSeenHead', async () => {
    const s = new StateStore(file); await s.load();
    await s.setAnchor(7, { path: 'a.ts', line: 1, side: 'new', anchorCommit: 'abc', source: 'criever' });
    await s.setViewed('a.ts', 'abc'); await s.setViewed('b.ts', 'abc'); await s.setViewed('b.ts', null);
    await s.setLastSeenHead('def');
    const j = JSON.parse(readFileSync(file, 'utf8'));
    expect(j.anchors['7'].source).toBe('criever');
    expect(j.viewed).toEqual({ 'a.ts': 'abc' });
    expect(j.lastSeenHead).toBe('def');
  });
  it('serializes concurrent saves without losing the temp file', async () => {
    const s = new StateStore(file); await s.load();
    await Promise.all([
      s.addDraft({ path: 'a.ts', line: 1, side: 'new', body: 'one', anchorCommit: 'h' }),
      s.addDraft({ path: 'a.ts', line: 2, side: 'new', body: 'two', anchorCommit: 'h' }),
      s.setViewed('a.ts', 'h'),
      s.setLastSeenHead('h'),
    ]);
    const s2 = new StateStore(file); await s2.load();
    expect(s2.state.drafts).toHaveLength(2);
    expect(s2.state.viewed).toEqual({ 'a.ts': 'h' });
    expect(s2.state.lastSeenHead).toBe('h');
    expect(existsSync(file + '.tmp')).toBe(false);
  });

  it('corrupt file → renamed to .bak, empty state, warning set', async () => {
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, '{not json');
    const s = new StateStore(file); await s.load();
    expect(s.state).toEqual(emptyState());
    expect(s.warning).toMatch(/\.bak/);
    expect(existsSync(file + '.bak')).toBe(true);
  });
});
