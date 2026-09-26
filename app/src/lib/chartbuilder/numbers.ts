/**
 * "Show the numbers" (SPEC §12 accessibility): a plain table of what each chart draws, built from
 * the engine's chart data. Long point-level data (scatter points, density curves) is summarised.
 */
import type { ChartSpec } from "@/contracts";
import { apaNum } from "@/lib/chartbuilder/compile";
import type { ChartRow, ChartsDataResult } from "@/lib/chartbuilder/types";

export interface NumbersColumn {
  key: string;
  label: string;
  numeric?: boolean;
  digits?: number;
}
export interface NumbersTable {
  columns: NumbersColumn[];
  rows: ChartRow[];
  caption: string;
}

const txt = (key: string, label: string): NumbersColumn => ({ key, label });
const nm = (key: string, label: string, digits = 2): NumbersColumn => ({ key, label, numeric: true, digits });

function groups(data: ChartsDataResult, keys = ["x", "color", "facet", "facet2"]): NumbersColumn[] {
  const l = data.meta.labels ?? {};
  return keys.filter((k) => data.rows.some((r) => r[k] !== undefined)).map((k) => txt(k, l[k] ?? k));
}

export function numbersTable(spec: ChartSpec, data: ChartsDataResult): NumbersTable {
  const l = data.meta.labels ?? {};
  const main = data.rows;
  switch (spec.chart_type) {
    case "bar":
    case "grouped_bar":
    case "line":
    case "interaction": {
      const cols = [...groups(data), nm("n", "n", 0), nm("value", l.value ?? "Value")];
      if (data.meta.aggregate === "mean") cols.push(nm("sd", "SD"), nm("se", "SE"), nm("ci_low", "95% CI lower"), nm("ci_high", "95% CI upper"));
      return { columns: cols, rows: main, caption: `${l.value ?? "Values"} for each group` };
    }
    case "stacked_bar":
    case "percent_bar":
      return { columns: [...groups(data), nm("count", "Count", 0), nm("percent", "Percent", 1)], rows: main, caption: "Counts and percentages" };
    case "likert_diverging":
      return {
        columns: [txt("item", "Item"), ...groups(data, ["facet", "facet2"]), txt("response", "Response"), nm("count", "Count", 0), nm("percent", "Percent", 1)],
        rows: main,
        caption: "Responses to each item",
      };
    case "histogram":
      return { columns: [...groups(data, ["color", "facet", "facet2"]), nm("bin_start", "From"), nm("bin_end", "To"), nm("count", "Count", 0)], rows: main, caption: `Bins of width ${apaNum(data.meta.bin_width, true)}` };
    case "density":
      return { columns: [...groups(data, ["color", "facet", "facet2"]), nm("n", "n", 0), nm("bandwidth", "Bandwidth", 3)], rows: (data.meta.bandwidths ?? []) as ChartRow[], caption: "Gaussian kernel density (Scott's bandwidth)" };
    case "qq":
      return { columns: [...groups(data, ["color", "facet", "facet2"]), nm("theoretical", "Expected (z)"), nm("sample", "Observed")], rows: main, caption: "Observed scores against normal quantiles" };
    case "box":
    case "violin":
      return {
        columns: [...groups(data), nm("n", "n", 0), nm("min", "Min"), nm("q1", "Q1"), nm("median", "Median"), nm("q3", "Q3"), nm("max", "Max"), nm("whisker_low", "Lower whisker"), nm("whisker_high", "Upper whisker"), ...(spec.chart_type === "box" ? [nm("n_outliers", "Unusual scores", 0)] : [])],
        rows: main.filter((r) => r.kind === "box"),
        caption: "Five-number summary (whiskers reach the furthest score within 1.5 × IQR)",
      };
    case "scatter":
      return {
        columns: [...groups(data, ["color", "facet", "facet2"]).filter((c) => (data.meta.fits ?? []).some((f) => (f as unknown as Record<string, unknown>)[c.key] !== undefined)), nm("n", "n", 0), nm("slope", "Slope", 3), nm("intercept", "Intercept", 3), nm("r", "r"), nm("r2", "R²")],
        rows: (data.meta.fits ?? []) as unknown as ChartRow[],
        caption: `Straight-line fit (least squares) of ${l.y ?? "Y"} on ${l.x ?? "X"}`,
      };
    case "correlation_heatmap":
      return { columns: [txt("row", "Variable"), txt("col", "With"), nm("r", "r"), nm("n", "n", 0)], rows: main.filter((r) => Number(r.row_index) < Number(r.col_index)), caption: `${data.meta.method === "spearman" ? "Spearman" : "Pearson"} correlations (pairwise)` };
    case "scree":
      return { columns: [nm("number", "Factor", 0), txt("series", "Series"), nm("eigenvalue", "Eigenvalue", 3)], rows: main, caption: "Eigenvalues" };
    case "cfa_path":
      return {
        columns: [txt("from", "Factor"), txt("to", "Item"), txt("edge_type", "Path"), nm("weight", "Standardized estimate"), nm("p", "p", 3)],
        rows: main.filter((r) => r.kind === "edge"),
        caption: "Standardized estimates",
      };
  }
}

export function formatCell(v: unknown, col: NumbersColumn): string {
  if (v === null || v === undefined) return "";
  if (col.numeric && typeof v === "number") return col.digits === 0 ? String(Math.round(v)) : v.toFixed(col.digits ?? 2);
  return String(v);
}
