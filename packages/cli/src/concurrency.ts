/** Maps `items` with at most `limit` calls in flight, preserving order; the first failure wins. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0; let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try { out[index] = await fn(items[index]!, index); }
      catch (e) { failed = true; throw e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
