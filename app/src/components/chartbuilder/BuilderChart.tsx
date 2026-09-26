import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import type { View } from "vega";
import type { ChartSpec } from "@/contracts";
import { compileChart } from "@/lib/chartbuilder/compile";
import type { ChartsDataResult } from "@/lib/chartbuilder/types";
import type { ResolvedTheme } from "@/stores/theme";

/** Imperative handle for exports (PNG/SVG/PDF): `view.toImageURL("png", scale)`, `view.toSVG()`. */
export interface BuilderChartHandle {
  getVegaView: () => View | null;
}

let activeView: View | null = null;
/** The most recently rendered chart-builder view (for export code outside the component tree). */
export function getActiveChartView(): View | null {
  return activeView;
}

/**
 * The chart builder's Vega-Lite chart. Rendered with Vega's AST interpreter so it runs under the
 * strict Tauri CSP (no eval); SVG renderer so exports stay vector.
 */
export function BuilderChart({ spec, data, theme, label, ref }: { spec: ChartSpec; data: ChartsDataResult; theme: ResolvedTheme; label: string; ref?: Ref<BuilderChartHandle> }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<View | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const vl = useMemo(() => compileChart(spec, data, { theme }), [spec, data, theme]);

  useImperativeHandle(ref, () => ({ getVegaView: () => view.current }), []);

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
        view.current = res.view;
        activeView = res.view;
        finalize = () => {
          if (activeView === res.view) activeView = null;
          view.current = null;
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
