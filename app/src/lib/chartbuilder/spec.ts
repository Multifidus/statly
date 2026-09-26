/** ChartSpec construction and editing helpers for the chart builder (pure). */
import type { ChartSpec, ChartType, ShelfAggregate } from "@/contracts";
import { CHART_INFO } from "@/lib/chartbuilder/catalog";
import type { BuilderCustomization, ShelfName } from "@/lib/chartbuilder/types";

export function newChartId(): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `chart_${r}`;
}

export function newChartSpec(type: ChartType = "bar", now = new Date().toISOString()): ChartSpec {
  return {
    schema_version: 1,
    id: newChartId(),
    chart_type: type,
    source: { kind: CHART_INFO[type].source, test_log_entry_id: null },
    shelves: { x: [], y: [], color: [], facet: [] },
    subset: [],
    error_bars: CHART_INFO[type].errorBars ? "ci95" : "none",
    customization: { palette: "colorblind_safe" },
    theme_preset: "statly",
    created_at: now,
    modified_at: now,
  };
}

/** The spec fields that change the engine's data (everything else is styling). */
export function dataKey(spec: ChartSpec): string {
  const c = spec.customization as BuilderCustomization;
  return JSON.stringify([spec.chart_type, spec.source, spec.shelves, spec.subset, spec.error_bars, c.bins ?? null, c.correlation_method ?? null, c.fit_line ?? null, c.bandwidth_adjust ?? null]);
}

export function defaultAggregate(type: ChartType, shelf: ShelfName): ShelfAggregate {
  return shelf === "y" && ["bar", "grouped_bar", "line", "interaction"].includes(type) ? "mean" : "none";
}

/** Switch chart type, keeping the shelves (and trimming shelves the new type doesn't use). */
export function withChartType(spec: ChartSpec, type: ChartType): ChartSpec {
  const info = CHART_INFO[type];
  const shelves = { ...spec.shelves };
  for (const s of ["x", "y", "color", "facet"] as ShelfName[]) {
    const rule = info.shelves[s];
    const kept = rule ? spec.shelves[s].slice(0, rule.max) : [];
    const means = defaultAggregate(type, s) === "mean";
    (shelves as Record<string, unknown>)[s] = kept.map((f) => ({ ...f, aggregate: means ? (f.aggregate === "none" ? "mean" : f.aggregate) : "none" }));
  }
  const kind = info.source;
  return {
    ...spec,
    chart_type: type,
    shelves,
    source: kind === spec.source.kind ? spec.source : { kind, test_log_entry_id: null },
    error_bars: info.errorBars ? (spec.error_bars === "none" && !CHART_INFO[spec.chart_type].errorBars ? "ci95" : spec.error_bars) : "none",
  };
}

/** Add `variable` to a shelf (replacing the last one when the shelf is full). Removes it elsewhere. */
export function addToShelf(spec: ChartSpec, shelf: ShelfName, variable: string, index?: number): ChartSpec {
  const rule = CHART_INFO[spec.chart_type].shelves[shelf];
  if (!rule) return spec;
  const shelves = removeEverywhere(spec.shelves, variable);
  const list = [...shelves[shelf]];
  const field = { variable, aggregate: defaultAggregate(spec.chart_type, shelf) };
  if (list.length >= rule.max) list.splice(rule.max - 1, list.length, field);
  else list.splice(index ?? list.length, 0, field);
  return { ...spec, shelves: { ...shelves, [shelf]: list } as ChartSpec["shelves"] };
}

function removeEverywhere(shelves: ChartSpec["shelves"], variable: string): ChartSpec["shelves"] {
  return {
    x: shelves.x.filter((f) => f.variable !== variable),
    y: shelves.y.filter((f) => f.variable !== variable),
    color: shelves.color.filter((f) => f.variable !== variable) as ChartSpec["shelves"]["color"],
    facet: shelves.facet.filter((f) => f.variable !== variable) as ChartSpec["shelves"]["facet"],
  };
}

export function removeFromShelf(spec: ChartSpec, shelf: ShelfName, variable: string): ChartSpec {
  return { ...spec, shelves: { ...spec.shelves, [shelf]: spec.shelves[shelf].filter((f) => f.variable !== variable) } as ChartSpec["shelves"] };
}

export function setAggregate(spec: ChartSpec, shelf: ShelfName, variable: string, aggregate: ShelfAggregate): ChartSpec {
  return { ...spec, shelves: { ...spec.shelves, [shelf]: spec.shelves[shelf].map((f) => (f.variable === variable ? { ...f, aggregate } : f)) } as ChartSpec["shelves"] };
}

/** Swap to/from the APA figure preset. */
export function withPreset(spec: ChartSpec, preset: ChartSpec["theme_preset"], figureNumber = 1): ChartSpec {
  const c = spec.customization as BuilderCustomization;
  if (preset === "apa") {
    return {
      ...spec,
      theme_preset: "apa",
      customization: { ...c, gridlines: false, legend_position: c.legend_position ?? "bottom", font_family: undefined, figure_number: c.figure_number ?? figureNumber },
    };
  }
  return { ...spec, theme_preset: "statly", customization: { ...c, gridlines: undefined, greyscale: false } };
}

/** Drop undefined keys so the spec stays valid JSON for the contract. */
export function cleanSpec(spec: ChartSpec): ChartSpec {
  return JSON.parse(JSON.stringify(spec)) as ChartSpec;
}
