import { existsSync, mkdirSync } from 'node:fs';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

export const VSCODE_VERSION = '1.95.3';
export function platformTag() {
  const a = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (process.platform === 'darwin') return `darwin-${a}` as const;
  if (process.platform === 'win32') return 'win32-x64' as const;
  return `linux-${a}` as const;
}
export const installDir = (cacheDir: string, version: string) => join(cacheDir, `openvscode-server-v${version}-${platformTag()}`);
export const defaultDownloadUrl = (v: string, tag: string) => `https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v${v}/openvscode-server-v${v}-${tag}.${tag.startsWith('win32') ? 'zip' : 'tar.gz'}`;
export function openUrl(port: number, repoRoot: string, path: string, line: number) {
  // Openvscode-server 1.95.3's workbench only honours the `:line` suffix on
  // "openFile" when "gotoLineMode" is also present in the payload. Without it the whole path
  // (including ":line")
  // is treated as a literal, nonexistent file.
  const payload = JSON.stringify([['openFile', `vscode-remote://localhost${repoRoot}/${path}:${line}`], ['gotoLineMode', 'true']]);
  return `http://127.0.0.1:${port}/?folder=${encodeURIComponent(repoRoot)}&payload=${encodeURI(payload)}`;
}

export function createVscode(o: {
  repoRoot: string; cacheDir: string; log: (s: string) => void; version?: string;
  downloadUrl?: (v: string, tag: string) => string; spawn?: typeof Bun.spawn; fetch?: typeof fetch; waitForPort?: (port: number) => Promise<void>;
}) {
  const version = o.version ?? VSCODE_VERSION, spawn = o.spawn ?? Bun.spawn, fetchFn = o.fetch ?? fetch;
  const dir = installDir(o.cacheDir, version); const bin = join(dir, 'bin', process.platform === 'win32' ? 'openvscode-server.cmd' : 'openvscode-server');
  let proc: ReturnType<typeof Bun.spawn> | null = null; let port: number | null = null; let starting: Promise<number> | null = null;

  const waitForPort = o.waitForPort ?? (async (p: number) => {
    for (let i = 0; i < 100; i++) { try { await fetchFn(`http://127.0.0.1:${p}/`); return; } catch { await new Promise(r => setTimeout(r, 200)); } }
    throw new Error(`openvscode-server did not answer on port ${p} within 20 s`);
  });

  async function ensureInstalled() {
    if (existsSync(bin)) return;
    const url = (o.downloadUrl ?? defaultDownloadUrl)(version, platformTag());
    o.log(`Downloading openvscode-server ${version} from ${url} …`);
    mkdirSync(o.cacheDir, { recursive: true });
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}.\nDownload it manually and extract into ${dir}`);
    const archive = join(o.cacheDir, `openvscode-${version}${url.endsWith('.zip') ? '.zip' : '.tar.gz'}`);
    await writeFile(archive, new Uint8Array(await res.arrayBuffer()));
    const tar = spawn(['tar', '-xf', archive, '-C', o.cacheDir], { stdout: 'inherit', stderr: 'inherit' });
    if ((await tar.exited) !== 0) throw new Error(`Extracting ${archive} failed. Extract it manually into ${dir}`);
    await rm(archive, { force: true });
    if (!existsSync(bin)) throw new Error(`Extracted archive did not contain ${bin}`);
    o.log('openvscode-server installed.');
  }

  async function ensureRunning(): Promise<number> {
    if (port != null) return port;
    if (starting) return starting;
    starting = (async () => {
      await ensureInstalled();
      proc = spawn([bin, '--host', '127.0.0.1', '--port', '0', '--without-connection-token', '--server-data-dir', join(o.cacheDir, 'vscode-data'), '--default-folder', o.repoRoot], { stdout: 'pipe', stderr: 'pipe' });
      const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader(); let buf = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) throw new Error('openvscode-server exited before printing its port');
        buf += new TextDecoder().decode(value);
        const m = /Web UI available at http:\/\/(?:127\.0\.0\.1|localhost):(\d+)/.exec(buf); if (m) { port = +m[1]!; break; }
      }
      // The rest of stdout is dropped; add a drain loop if the process ever blocks on a full pipe.
      void reader.releaseLock();
      await waitForPort(port!);
      o.log(`openvscode-server on http://127.0.0.1:${port}`);
      return port!;
    })();
    try { return await starting; } catch (e) { starting = null; proc = null; port = null; throw e; }
  }

  return {
    async open(path: string, line: number) { return openUrl(await ensureRunning(), o.repoRoot, path, line); },
    async stop() {
      if (!proc) return; const p = proc; proc = null; port = null; starting = null;
      let exited = false;
      void p.exited.then(() => { exited = true; });
      p.kill('SIGTERM');
      setTimeout(() => { if (!exited) p.kill('SIGKILL'); }, 3000);
    },
  };
}
