/**
 * Vega-Lite specs for the supporting visuals an AnalysisResult ships in `chart_data`
 * (Q-Q plots and histograms today). Colors are an Okabe-Ito-derived pair validated for
 * colorblind separation on the light and dark surfaces; text/axes use neutral ink.
 */
import type { ChartType } from "@/contracts";
import type { ResolvedTheme } from "@/stores/theme";

type Row = Record<string, number | string | boolean | null>;
// Vega-Lite's TopLevelSpec is huge; specs here are plain JSON.
export type VlSpec = Record<string, unknown>;

export const CHART_COLORS: Record<ResolvedTheme, { mark: string; reference: string; ink: string; muted: string; grid: string; surface: string }> = {
  light: { mark: "#0072B2", reference: "#D55E00", ink: "#1a1a19", muted: "#5f5f5a", grid: "#e6e5e1", surface: "transparent" },
  dark: { mark: "#3A9AD9", reference: "#D17A1F", ink: "#f0efec", muted: "#b5b4ae", grid: "#383835", surface: "transparent" },
};

export function vegaConfig(theme: ResolvedTheme): VlSpec {
  const c = CHART_COLORS[theme];
  return {
    background: c.surface,
    font: "ui-sans-serif, system-ui, sans-serif",
    view: { stroke: null },
    axis: {
      labelColor: c.muted,
      titleColor: c.ink,
      domainColor: c.grid,
      tickColor: c.grid,
      gridColor: c.grid,
      labelFontSize: 11,
      titleFontSize: 12,
      titleFontWeight: 500,
    },
    title: { color: c.ink, fontSize: 13, fontWeight: 600, anchor: "start" },
    range: { category: [c.mark, c.reference] },
  };
}

/** Least-squares line of sample on theoretical quantiles (slope ~ SD, intercept ~ mean). */
export function qqLine(rows: Row[]): { x: number; y: number }[] {
  const pts = rows.map((r) => [Number(r.theoretical), Number(r.sample)]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pts.length < 2) return [];
  const mx = pts.reduce((a, [x]) => a + x, 0) / pts.length;
  const my = pts.reduce((a, [, y]) => a + y, 0) / pts.length;
  const sxx = pts.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  const slope = sxx ? pts.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0) / sxx : 0;
  const xs = pts.map(([x]) => x);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  return [x0, x1].map((x) => ({ x, y: my + slope * (x - mx) }));
}

export function isSupportedChart(type: ChartType, rows: Row[] | undefined): boolean {
  if (!rows?.length) return false;
  if (type === "qq") return "theoretical" in rows[0] && "sample" in rows[0];
  if (type === "histogram") return "bin_start" in rows[0] && "bin_end" in rows[0] && "count" in rows[0];
  return false;
}

export function chartSpec(type: ChartType, rows: Row[], theme: ResolvedTheme, title: string): VlSpec | null {
  const c = CHART_COLORS[theme];
  const base = { $schema: "https://vega.github.io/schema/vega-lite/v6.json", width: "container", height: 200, config: vegaConfig(theme), description: title };
  if (type === "qq") {
    return {
      ...base,
      layer: [
        {
          data: { values: qqLine(rows) },
          mark: { type: "line", color: c.reference, strokeWidth: 2, strokeDash: [6, 4] },
          encoding: { x: { field: "x", type: "quantitative" }, y: { field: "y", type: "quantitative" } },
        },
        {
          data: { values: rows },
          mark: { type: "point", filled: true, size: 48, color: c.mark, opacity: 0.85 },
          encoding: {
            x: { field: "theoretical", type: "quantitative", title: "Expected if normal (z)" },
            y: { field: "sample", type: "quantitative", title: "Observed score", scale: { zero: false } },
            tooltip: [
              { field: "theoretical", type: "quantitative", title: "Expected (z)", format: ".2f" },
              { field: "sample", type: "quantitative", title: "Observed", format: ".2f" },
            ],
          },
        },
      ],
    };
  }
  if (type === "histogram") {
    return {
      ...base,
      data: { values: rows },
      // No corner radius: Vega-Lite 6 collapses binned bars to zero width when it is set.
      mark: { type: "bar", color: c.mark, binSpacing: 0, stroke: theme === "dark" ? "#0a0a0a" : "#ffffff", strokeWidth: 2 },
      encoding: {
        x: { field: "bin_start", type: "quantitative", bin: { binned: true }, title: "Score" },
        x2: { field: "bin_end" },
        y: { field: "count", type: "quantitative", title: "Number of people" },
        tooltip: [
          { field: "bin_start", type: "quantitative", title: "From", format: ".2f" },
          { field: "bin_end", type: "quantitative", title: "To", format: ".2f" },
          { field: "count", type: "quantitative", title: "Count" },
        ],
      },
    };
  }
  return null;
}
