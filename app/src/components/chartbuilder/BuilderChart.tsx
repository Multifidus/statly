import { useEffect, useMemo, useRef, useState } from "react";
import type { ChartSpec } from "@/contracts";
import { compileChart } from "@/lib/chartbuilder/compile";
import type { ChartsDataResult } from "@/lib/chartbuilder/types";
import type { ResolvedTheme } from "@/stores/theme";

/**
 * The chart builder's Vega-Lite chart. Rendered with Vega's AST interpreter so it runs under the
 * strict Tauri CSP (no eval); SVG renderer so exports stay vector. "Save figure…" doesn't read
 * bytes off this mounted view — it re-renders the compiled spec off-screen instead (SaveFigureButton
 * -> lib/export/saveFigure.ts -> lib/export/figure.ts's `withVlSpec`), so the print palette applies
 * regardless of this preview's theme; this component is purely the on-screen preview.
 */
export function BuilderChart({ spec, data, theme, label }: { spec: ChartSpec; data: ChartsDataResult; theme: ResolvedTheme; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const vl = useMemo(() => compileChart(spec, data, { theme }), [spec, data, theme]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    let finalize: (() => void) | null = null;
    setFailed(null);
    (async () => {
      try {
        const [{ default: embed }, { expressionInterpreter }] = await Promise.all([import("vega-embed"), import("vega-interpreter")]);
        if (cancelled) return;
        const res = await embed(el, vl as never, { actions: false, renderer: "svg", ast: true, expr: expressionInterpreter, tooltip: true });
        if (cancelled) {
          res.finalize();
          return;
        }
        finalize = () => {
          res.finalize();
        };
      } catch (e) {
        if (!cancelled) setFailed(String((e as Error)?.message ?? e));
      }
    })();
    return () => {
      cancelled = true;
      finalize?.();
    };
  }, [vl]);

  if (failed) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="chart-render-failed">
        This chart couldn't be drawn. The numbers are in the table below.
      </p>
    );
  }
  return <div ref={host} role="img" aria-label={label} className="max-w-full overflow-auto" data-testid="builder-chart" />;
}
