import { chmod, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Listener = { stop(closeActiveConnections?: boolean): void };

export class AiReviewTransport {
  private unixServer: Listener | null = null;
  private tcpServer: (Listener & { port: number | undefined }) | null = null;
  private directory: string | null = null;
  private socket: string | null = null;

  constructor(private readonly handle: (request: Request) => Promise<Response>) {}

  get socketPath(): string {
    if (!this.socket) throw new Error('AI review channel is not started');
    return this.socket;
  }

  async start(): Promise<void> {
    if (this.unixServer) return;
    const directory = join(tmpdir(), `criever-ai-${crypto.randomUUID()}`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const socket = join(directory, 'review.sock');
    this.directory = directory;
    this.socket = socket;
    this.unixServer = Bun.serve({ unix: socket, fetch: this.handle });
  }

  async endpoint(transport: 'unix' | 'tcp'): Promise<Readonly<Record<string, string>>> {
    await this.start();
    if (transport === 'unix') return { CRIEVER_AI_SOCKET: this.socketPath };
    if (!this.tcpServer) this.tcpServer = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: this.handle });
    const port = this.tcpServer.port;
    if (port === undefined) throw new Error('AI review loopback listener has no port');
    return { CRIEVER_AI_URL: `http://127.0.0.1:${port}/review` };
  }

  stopAccepting(): void {
    this.unixServer?.stop(false);
    this.tcpServer?.stop(false);
  }

  async close(): Promise<void> {
    this.unixServer?.stop(true);
    this.tcpServer?.stop(true);
    this.unixServer = null;
    this.tcpServer = null;
    if (this.directory) await rm(this.directory, { recursive: true, force: true });
    this.directory = null;
    this.socket = null;
  }
}
