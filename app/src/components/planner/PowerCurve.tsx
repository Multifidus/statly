import { useState } from "react";
import { CHART_COLORS } from "@/lib/chartSpecs";
import { useThemeStore } from "@/stores/theme";

type Row = Record<string, number | string | boolean | null>;

/**
 * Power curve (power vs sample size) for the planned effect, from the engine's
 * `chart_data.power_curve`. One series, so no legend; the target power is a dashed reference line
 * and the planned n is marked and labelled. Hover shows the exact power; a table view is below.
 */
export function PowerCurve({ rows, planned, nLabel }: { rows: Row[]; planned: number | null; nLabel: string }) {
  const theme = useThemeStore((s) => s.resolved);
  const c = CHART_COLORS[theme];
  const [hover, setHover] = useState<number | null>(null);
  const pts = rows
    .filter((r) => r.series === "planned")
    .map((r) => ({ n: Number(r.n), power: Number(r.power) }))
    .filter((p) => Number.isFinite(p.n) && Number.isFinite(p.power))
    .sort((a, b) => a.n - b.n);
  if (pts.length < 2) return null;
  const target = Number(rows[0]?.target_power ?? 0.8);

  const W = 560;
  const H = 240;
  const m = { l: 44, r: 16, t: 14, b: 38 };
  const nMin = pts[0].n;
  const nMax = pts[pts.length - 1].n;
  const x = (n: number) => m.l + ((n - nMin) / Math.max(nMax - nMin, 1)) * (W - m.l - m.r);
  const y = (p: number) => m.t + (1 - p) * (H - m.t - m.b);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.n).toFixed(1)},${y(p.power).toFixed(1)}`).join(" ");
  const xticks = Array.from({ length: 5 }, (_, i) => Math.round(nMin + ((nMax - nMin) * i) / 4));
  const plannedPt = planned !== null ? pts.reduce((best, p) => (Math.abs(p.n - planned) < Math.abs(best.n - planned) ? p : best), pts[0]) : null;
  const h = hover !== null ? pts[hover] : null;

  return (
    <figure className="grid gap-2" data-testid="power-curve">
      <figcaption className="text-sm font-medium">Chance of detecting your effect, by sample size</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-xl" role="img" aria-label={`Power curve: power rises from ${Math.round(pts[0].power * 100)}% at ${nMin} to ${Math.round(pts[pts.length - 1].power * 100)}% at ${nMax} (${nLabel}).`} onMouseLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke={c.grid} strokeWidth={1} />
            <text x={m.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill={c.muted}>
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {xticks.map((t) => (
          <text key={t} x={x(t)} y={H - m.b + 16} textAnchor="middle" fontSize={11} fill={c.muted}>
            {t}
          </text>
        ))}
        <text x={(m.l + W - m.r) / 2} y={H - 4} textAnchor="middle" fontSize={11} fill={c.muted}>
          Sample size ({nLabel})
        </text>
        <line x1={m.l} x2={W - m.r} y1={y(target)} y2={y(target)} stroke={c.reference} strokeWidth={1.5} strokeDasharray="5 4" />
        <text x={W - m.r} y={y(target) - 5} textAnchor="end" fontSize={11} fill={c.ink}>
          Target {Math.round(target * 100)}%
        </text>
        <path d={path} fill="none" stroke={c.mark} strokeWidth={2} strokeLinejoin="round" />
        {plannedPt && (
          <g>
            <line x1={x(plannedPt.n)} x2={x(plannedPt.n)} y1={y(plannedPt.power)} y2={H - m.b} stroke={c.muted} strokeWidth={1} strokeDasharray="2 3" />
            <circle cx={x(plannedPt.n)} cy={y(plannedPt.power)} r={5} fill={c.mark} stroke={theme === "dark" ? "#1a1a19" : "#ffffff"} strokeWidth={2} />
            <text x={x(plannedPt.n) + 8} y={y(plannedPt.power) + 16} fontSize={11} fill={c.ink}>
              Your plan: {plannedPt.n}
            </text>
          </g>
        )}
        {h && (
          <g pointerEvents="none">
            <line x1={x(h.n)} x2={x(h.n)} y1={m.t} y2={H - m.b} stroke={c.muted} strokeWidth={1} />
            <circle cx={x(h.n)} cy={y(h.power)} r={4} fill={c.mark} />
            <text x={Math.min(x(h.n) + 6, W - 120)} y={m.t + 12} fontSize={11} fill={c.ink}>
              n = {h.n}: {Math.round(h.power * 100)}% power
            </text>
          </g>
        )}
        {pts.map((p, i) => {
          const left = i ? (x(pts[i - 1].n) + x(p.n)) / 2 : m.l;
          const right = i < pts.length - 1 ? (x(p.n) + x(pts[i + 1].n)) / 2 : W - m.r;
          return <rect key={p.n} x={left} y={m.t} width={Math.max(right - left, 1)} height={H - m.t - m.b} fill="transparent" onMouseEnter={() => setHover(i)} />;
        })}
      </svg>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Show the numbers</summary>
        <table className="mt-2 text-xs">
          <thead>
            <tr>
              <th className="pr-4 text-left font-medium">Sample size ({nLabel})</th>
              <th className="text-right font-medium">Power</th>
            </tr>
          </thead>
          <tbody>
            {pts.map((p) => (
              <tr key={p.n}>
                <td className="pr-4 tabular-nums">{p.n}</td>
                <td className="text-right tabular-nums">{(p.power * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
