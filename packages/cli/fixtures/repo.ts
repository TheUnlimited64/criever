import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ENV = { GIT_AUTHOR_NAME: 'Alex Morgan', GIT_AUTHOR_EMAIL: 'alex@example.test', GIT_COMMITTER_NAME: 'Alex Morgan', GIT_COMMITTER_EMAIL: 'alex@example.test' };
async function git(cwd: string, args: string[], date?: string) {
  const p = Bun.spawn(['git', ...args], { cwd, env: { ...process.env, ...ENV, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) }, stdout: 'pipe', stderr: 'pipe' });
  const out = await new Response(p.stdout).text(); if ((await p.exited) !== 0) throw new Error(await new Response(p.stderr).text()); return out.trim();
}
function write(root: string, files: Record<string, string | null>) {
  for (const [p, c] of Object.entries(files)) {
    const f = join(root, p);
    if (c === null) rmSync(f); else { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
  }
}

const DEVICE_LIST_MAIN = `import { useRef } from 'react';
import { DeviceRow } from './DeviceRow';
import { useIntersection } from '../hooks/useIntersection';
import { useDevices } from '../api/devices';
import styles from './DeviceList.module.css';

export function DeviceList({ filter }: { filter: string }) {
  const { data: items = [] } = useDevices(filter);
  const { ref } = useIntersection({ rootMargin: '200px' });
  return (
    <div className={styles.list} ref={ref}>
      {items.map(d => <DeviceRow key={d.id} device={d} />)}
    </div>
  );
}
`;
const DEVICE_LIST_C2 = `import { useRef } from 'react';
import { DeviceRow } from './DeviceRow';
import { useDeviceRows } from './useDeviceRows';
import { useDevices } from '../api/devices';
import styles from './DeviceList.module.css';

export function DeviceList({ filter }: { filter: string }) {
  const { data: items = [] } = useDevices(filter);
  const parentRef = useRef<HTMLDivElement>(null);
  const { rows, totalHeight, rowStyle } = useDeviceRows(items.length, parentRef);
  return (
    <div className={styles.list} ref={parentRef} style={{ height: totalHeight }}>
      {/* TODO use rows */}
      {items.map(d => <DeviceRow key={d.id} device={d} />)}
    </div>
  );
}
`;
const DEVICE_LIST_C3 = DEVICE_LIST_C2.replace(
  `      {/* TODO use rows */}\n      {items.map(d => <DeviceRow key={d.id} device={d} />)}\n`,
  `      {rows.map(r => (\n        <DeviceRow key={r.key} device={items[r.index]} style={rowStyle(r)} />\n      ))}\n`);
const USE_DEVICE_ROWS = `import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { type CSSProperties, type RefObject } from 'react';

export function useDeviceRows(count: number, parentRef: RefObject<HTMLDivElement>) {
  const v = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 8,
  });
  const rowStyle = (r: VirtualItem): CSSProperties => ({ position: 'absolute', top: 0, transform: \`translateY(\${r.start}px)\`, height: r.size });
  return { rows: v.getVirtualItems(), totalHeight: v.getTotalSize(), rowStyle };
}
`;
const DEVICES_MAIN = `import { useInfiniteQuery } from '@tanstack/react-query';
const PAGE_SIZE = 50;
export function useDevices(filter: string) {
  return useInfiniteQuery({
    queryKey: ['devices', filter],
    queryFn: ({ pageParam }) => fetchDevices(filter, pageParam, PAGE_SIZE),
    getNextPageParam: last => last.next,
  });
}
`;
const DEVICES_C1 = `import { useQuery } from '@tanstack/react-query';
export function useDevices(filter: string) {
  return useQuery({
    queryKey: ['devices', filter],
    queryFn: () => fetchDevices(filter),
  });
}
`;
const PKG_MAIN = `{
  "name": "review-fixture",
  "dependencies": {
    "@tanstack/react-query": "5.59.0",
    "react": "19.0.0",
    "react-dom": "19.0.0"
  },
  "private": true,
  "version": "1.0.0",
  "description": "Synthetic diff fixture",
  "type": "module",
  "scripts": {
    "build": "tsc --noEmit",
    "test": "vitest run"
  },
  "engines": {
    "node": ">=20"
  },
  "packageManager": "bun@1.3.14",
  "sideEffects": false,
  "files": [
    "src"
  ]
}
`;
const PKG_C1 = PKG_MAIN.replace(`    "@tanstack/react-query": "5.59.0",\n`, `    "@tanstack/react-query": "5.59.0",\n    "@tanstack/react-virtual": "3.10.8",\n`);

export async function buildFixtureRepo(root: string) {
  mkdirSync(root, { recursive: true });
  await git(root, ['init', '-q', '-b', 'main']);
  write(root, {
    'src/devices/DeviceList.tsx': DEVICE_LIST_MAIN,
    'src/devices/DeviceRow.tsx': `export function DeviceRow({ device }: { device: { id: string; name: string } }) {\n  return <div>{device.name}</div>;\n}\n`,
    'src/hooks/useIntersection.ts': `export function useIntersection(opts: { rootMargin: string }) {\n  return { ref: null, visible: true, opts };\n}\n`,
    'src/api/devices.ts': DEVICES_MAIN,
    'src/i18n/de.json': `{\n  "devices.title": "Geräte"\n}\n`,
    'src/index.ts': `export { DeviceList } from './devices/DeviceList';\n`,
    'package.json': PKG_MAIN,
    // Present at main and never touched by the feature branch — a plain, unchanged doc file for
    // exercising the markdown preview toggle on a file that isn't part of the diff.
    'docs/RELEASE_NOTES.md': `# Release Notes\n\n## 1.4.0\n- Faster device list rendering\n- Virtualized rows\n`,
  });
  await git(root, ['add', '-A']); await git(root, ['commit', '-qm', 'main'], '2026-08-30T08:00:00Z');
  const main = await git(root, ['rev-parse', 'HEAD']);
  await git(root, ['checkout', '-qb', 'feat/virtual-list-review']);
  write(root, {
    'src/devices/useDeviceRows.ts': USE_DEVICE_ROWS, 'src/hooks/useIntersection.ts': null, 'package.json': PKG_C1, 'src/api/devices.ts': DEVICES_C1,
    'src/devices/DeviceRow.tsx': `import type { CSSProperties } from 'react';\nexport function DeviceRow({ device, style }: { device: { id: string; name: string }; style?: CSSProperties }) {\n  return <div style={style}>{device.name}</div>;\n}\n`,
  });
  await git(root, ['add', '-A']); await git(root, ['commit', '-qm', 'add row helper'], '2026-09-01T08:00:00Z');
  const c1 = await git(root, ['rev-parse', 'HEAD']);
  write(root, { 'src/devices/DeviceList.tsx': DEVICE_LIST_C2 });
  await git(root, ['add', '-A']); await git(root, ['commit', '-qm', 'wire windowed rows'], '2026-09-02T08:00:00Z');
  const c2 = await git(root, ['rev-parse', 'HEAD']);
  write(root, { 'src/devices/DeviceList.tsx': DEVICE_LIST_C3, 'src/i18n/de.json': `{\n  "devices.title": "Geräte",\n  "devices.empty": "Keine Geräte"\n}\n` });
  await git(root, ['add', '-A']); await git(root, ['commit', '-qm', 'render visible items'], '2026-09-05T08:00:00Z');
  const c3 = await git(root, ['rev-parse', 'HEAD']);
  // the bare clone lives at a path that itself parses as a bitbucket remote, so no insteadOf rewriting is needed
  const bare = join(dirname(root), 'bitbucket.org', 'sample-workspace', 'review-fixture.git');
  mkdirSync(dirname(bare), { recursive: true });
  await git(root, ['clone', '-q', '--bare', root, bare]);
  await git(root, ['remote', 'add', 'origin', bare]);
  return { root, main, c1, c2, c3 };
}
