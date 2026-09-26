import { useEffect, useRef, useState } from "react";
import { summaryRows, summarySpec } from "@/lib/qualitative/chart";
import type { SummaryResult } from "@/lib/qualitative/types";
import { useThemeStore } from "@/stores/theme";

/**
 * Grouped bar chart of tag percentages (same Vega setup as components/charts/VegaChart: lazy
 * vega-embed, AST interpreter for the strict CSP, theme-aware), with the numbers in a table.
 */
export function TagBarChart({ summary, title }: { summary: SummaryResult; title: string }) {
  const host = useRef<HTMLDivElement>(null);
  const theme = useThemeStore((s) => s.resolved);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el || !summary.tags.length) return;
    let cancelled = false;
    let finalize: (() => void) | null = null;
    (async () => {
      try {
        const [{ default: embed }, { expressionInterpreter }] = await Promise.all([import("vega-embed"), import("vega-interpreter")]);
        if (cancelled) return;
        const res = await embed(el, summarySpec(summary, theme, title) as never, { actions: false, renderer: "svg", ast: true, expr: expressionInterpreter, tooltip: true });
        if (cancelled) res.finalize();
        else finalize = () => res.finalize();
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      finalize?.();
    };
  }, [summary, theme, title]);

  const rows = summaryRows(summary);
  return (
    <figure className="grid gap-2" data-testid="tag-chart">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      {failed ? (
        <p className="text-sm text-muted-foreground">This chart couldn't be drawn. The numbers are in the table.</p>
      ) : (
        <div ref={host} role="img" aria-label={title} className="w-full min-w-0" />
      )}
      <details className="text-xs">
        <summary className="cursor-pointer rounded-sm text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">Show the numbers</summary>
        <table className="mt-1 border-collapse">
          <thead>
            <tr>
              {["Tag", "Group", "Responses", "Out of", "Percent"].map((h) => (
                <th key={h} className="border-b px-2 py-0.5 text-left font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-2 py-0.5">{r.tag}</td>
                <td className="px-2 py-0.5">{r.group}</td>
                <td className="px-2 py-0.5 tabular-nums">{r.count}</td>
                <td className="px-2 py-0.5 tabular-nums">{r.n}</td>
                <td className="px-2 py-0.5 tabular-nums">{r.percent.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
