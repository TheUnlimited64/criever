export function fuzzyScore(query: string, path: string): number | null {
  const q = query.toLowerCase(), p = path.toLowerCase(); if (!q) return 0;
  const nameStart = p.lastIndexOf('/') + 1; let score = 0, pi = 0;
  for (const ch of q) {
    const idx = p.indexOf(ch, pi); if (idx < 0) return null;
    score += idx >= nameStart ? 3 : 1; if (idx === 0 || p[idx - 1] === '/' || p[idx - 1] === '.') score += 2; if (idx === pi) score += 1;
    pi = idx + 1;
  }
  return score - path.length / 100;
}
