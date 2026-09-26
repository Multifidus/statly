/**
 * Chart builder (SPEC §10.2, Phase 7) types. The engine's `charts.data` returns small aggregated
 * rows for a ChartSpec (contracts/README.md "Phase 7"); the app compiles them to Vega-Lite.
 */
import type { ChartCustomization, ChartSpec, ChartType, ShelfField } from "@/contracts";

export type ChartRow = Record<string, string | number | boolean | null | undefined>;

export interface ChartFit {
  color?: string;
  facet?: string;
  facet2?: string;
  n: number;
  slope: number | null;
  intercept: number | null;
  r: number | null;
  r2: number | null;
  x_min: number;
  x_max: number;
  points?: { x: number; y: number }[];
}

export interface ChartDataMeta {
  chart_type: ChartType;
  source: "dataset" | "analysis";
  levels?: Record<string, string[]>;
  labels?: Record<string, string>;
  aggregate?: "mean" | "median" | "sum" | "count";
  error_bars?: "none" | "se" | "sd" | "ci95";
  n_used?: number;
  n_excluded?: number;
  n_rows?: number;
  fits?: ChartFit[];
  fit_line?: string;
  lines?: (Record<string, string> & { slope: number; intercept: number; x_min: number; x_max: number })[];
  bandwidths?: (Record<string, string> & { bandwidth: number; n: number })[];
  neutral?: string | null;
  bin_width?: number;
  n_bins?: number;
  method?: string;
  fit?: Record<string, number | null>;
  n_factors?: number | null;
  [k: string]: unknown;
}

export interface ChartsDataParams {
  dataset_id: string | null;
  snapshot_id: string | null;
  spec: ChartSpec;
}

export interface ChartsDataResult {
  rows: ChartRow[];
  meta: ChartDataMeta;
}

/** Customization fields Statly adds beyond the contract's named ones (the schema is open). */
export interface BuilderCustomization extends ChartCustomization {
  /** Hex colors that replace the palette, in series order. */
  custom_colors?: string[] | null;
  /** APA preset: draw in black and greys instead of the palette. */
  greyscale?: boolean;
  figure_number?: number | null;
  figure_note?: string | null;
  /** Histogram bin count; absent = Freedman-Diaconis. */
  bins?: number | null;
  correlation_method?: "pearson" | "spearman";
  bandwidth_adjust?: number;
}

export type ShelfName = "x" | "y" | "color" | "facet";
export type { ShelfField };
