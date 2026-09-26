/** Mock `corrections.adjust`: the same p.adjust algorithms as engine/statly_engine/stats/corrections.py. */
import type { CorrectionMethod } from "@/contracts";

export function pAdjust(pValues: (number | null)[], method: CorrectionMethod): (number | null)[] {
  const idx = pValues.flatMap((p, i) => (p === null || Number.isNaN(p) ? [] : [i]));
  const p = idx.map((i) => pValues[i] as number);
  if (p.some((x) => x < 0 || x > 1)) throw new Error("p-values must be between 0 and 1");
  const n = p.length;
  let adj = [...p];
  if (method !== "none" && n > 1) {
    if (method === "bonferroni") adj = p.map((x) => Math.min(1, n * x));
    else {
      const holm = method === "holm";
      const o = p.map((_, i) => i).sort((a, b) => (holm ? p[a] - p[b] : p[b] - p[a]) || a - b);
      let acc = holm ? -Infinity : Infinity;
      o.forEach((oi, k) => {
        const v = holm ? (n - k) * p[oi] : (n / (n - k)) * p[oi];
        acc = holm ? Math.max(acc, v) : Math.min(acc, v);
        adj[oi] = Math.min(1, acc);
      });
    }
  }
  const out: (number | null)[] = pValues.map(() => null);
  idx.forEach((i, k) => (out[i] = adj[k]));
  return out;
}
