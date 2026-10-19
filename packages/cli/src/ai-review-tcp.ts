type Listener = { stop(closeActiveConnections?: boolean): void };
type TcpListener = Listener & { port: number | undefined };

export class AiReviewTransport {
  private server: TcpListener | null = null;

  constructor(private readonly handle: (request: Request) => Promise<Response>) {}

  async start(): Promise<void> {
    if (this.server) return;
    this.server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: this.handle });
  }

  async endpoint(): Promise<Readonly<Record<string, string>>> {
    await this.start();
    const port = this.server?.port;
    if (port === undefined) throw new Error('AI review loopback listener has no port');
    return { CRIEVER_AI_URL: `http://127.0.0.1:${port}/review` };
  }

  stopAccepting(): void {
    this.server?.stop(false);
  }

  async close(): Promise<void> {
    this.server?.stop(true);
    this.server = null;
  }
}
