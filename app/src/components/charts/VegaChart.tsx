import { useEffect, useRef, useState } from "react";
import type { ChartType } from "@/contracts";
import { chartSpec } from "@/lib/chartSpecs";
import { useThemeStore } from "@/stores/theme";

type Row = Record<string, number | string | boolean | null>;

/**
 * One supporting chart (Vega-Lite via vega-embed, loaded lazily). Uses Vega's AST interpreter
 * so it runs under the strict Tauri CSP (no eval), and re-renders on theme change. A data table
 * is always available beneath the chart for screen-reader and keyboard users.
 */
export function VegaChart({ type, rows, title }: { type: ChartType; rows: Row[]; title: string }) {
  const host = useRef<HTMLDivElement>(null);
  const theme = useThemeStore((s) => s.resolved);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = host.current;
    const spec = chartSpec(type, rows, theme, title);
    if (!el || !spec) return;
    let cancelled = false;
    let finalize: (() => void) | null = null;
    (async () => {
      try {
        const [{ default: embed }, { expressionInterpreter }] = await Promise.all([import("vega-embed"), import("vega-interpreter")]);
        if (cancelled) return;
        const res = await embed(el, spec as never, { actions: false, renderer: "svg", ast: true, expr: expressionInterpreter, tooltip: true });
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
  }, [type, rows, theme, title]);

  const cols = rows.length ? Object.keys(rows[0]) : [];
  return (
    <figure className="grid gap-2" data-testid={`chart-${type}`}>
      <figcaption className="text-sm font-medium">{title}</figcaption>
      {failed ? (
        <p className="text-sm text-muted-foreground">This chart couldn't be drawn. The numbers are in the table below.</p>
      ) : (
        <div ref={host} role="img" aria-label={title} className="w-full min-w-0" />
      )}
      <details className="text-xs">
        <summary className="cursor-pointer rounded-sm text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">Show the numbers</summary>
        <div className="mt-1 max-h-48 overflow-auto">
          <table className="border-collapse">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c} className="border-b px-2 py-0.5 text-left font-medium">
                    {c.replace(/_/g, " ")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c} className="px-2 py-0.5 tabular-nums">
                      {typeof r[c] === "number" ? (r[c] as number).toFixed(2) : String(r[c] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
