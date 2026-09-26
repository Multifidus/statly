/**
 * ChartSpec + engine chart data -> Vega-Lite (SPEC §10.2). Pure: no dataset access, no DOM.
 *
 * All rows travel in one inline dataset tagged by `_layer` (main rows, fit/reference lines), so any
 * layered chart can be faceted. Colors default to the colorblind-safe Okabe-Ito palette; the APA
 * preset uses a sans-serif font, no gridlines, black ink, "Figure N" + italic title and an optional
 * note, and can switch to greyscale.
 */
import type { ChartSpec } from "@/contracts";
import { CHART_COLORS, type VlSpec } from "@/lib/chartSpecs";
import type { ResolvedTheme } from "@/stores/theme";
import { divergingColors, paletteColors } from "@/lib/chartbuilder/palettes";
import type { BuilderCustomization, ChartRow, ChartsDataResult } from "@/lib/chartbuilder/types";

export const VL_SCHEMA = "https://vega.github.io/schema/vega-lite/v6.json";
export const APA_FONT = "Arial, Helvetica, sans-serif";
export const DEFAULT_FONT = "ui-sans-serif, system-ui, sans-serif";
export const DEFAULT_SIZE = { width: 480, height: 300 };

const ERROR_LABEL = { se: "±1 SE", sd: "±1 SD", ci95: "95% CI" } as const;

/** APA style numbers: two decimals, no leading zero when |x| < 1 (for r, loadings). */
export function apaNum(x: number | null | undefined, leadingZero = false): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "";
  const s = x.toFixed(2);
  return leadingZero ? s : s.replace(/^(-?)0\./, "$1.");
}

interface Ctx {
  spec: ChartSpec;
  data: ChartsDataResult;
  theme: ResolvedTheme;
  c: BuilderCustomization;
  apa: boolean;
  ink: string;
  muted: string;
  surface: string;
  levels: Record<string, string[]>;
  labels: Record<string, string>;
  /** Series colors for levels.color (or a single color when there is no color field). */
  colors: string[];
  legend: VlSpec | null;
  hasColor: boolean;
  width: number;
  height: number;
}

interface Built {
  layers: VlSpec[];
  extra?: ChartRow[];
  /** Replace the automatic facet (violin puts its grouping in columns). */
  facet?: VlSpec | null;
  width?: number;
  height?: number;
  resolve?: VlSpec;
}

const only = (layer: string) => ({ filter: { field: "_layer", equal: layer } });
const kindIs = (kind: string) => ({ filter: { field: "kind", equal: kind } });

function axisScale(a: { min?: number | null; max?: number | null } | undefined, base: VlSpec = {}): VlSpec {
  const s: VlSpec = { ...base };
  const hasMin = typeof a?.min === "number";
  const hasMax = typeof a?.max === "number";
  if (hasMin && hasMax) s.domain = [a!.min, a!.max];
  else if (hasMin) s.domainMin = a!.min;
  else if (hasMax) s.domainMax = a!.max;
  if (hasMin) s.zero = false;
  if (hasMin || hasMax) s.clamp = true;
  return s;
}

function xTitle(ctx: Ctx, fallback: string | null | undefined): string | null {
  const l = ctx.c.x_axis?.label;
  return l !== undefined && l !== null ? l : (fallback ?? null);
}
function yTitle(ctx: Ctx, fallback: string | null | undefined): string | null {
  const l = ctx.c.y_axis?.label;
  return l !== undefined && l !== null ? l : (fallback ?? null);
}

function colorEnc(ctx: Ctx, field = "color", title?: string): VlSpec {
  return {
    field,
    type: "nominal",
    sort: ctx.levels[field] ?? null,
    scale: { domain: ctx.levels[field] ?? [], range: ctx.colors },
    legend: ctx.legend ? { ...ctx.legend, title: title ?? ctx.labels[field] ?? null } : null,
    title: title ?? ctx.labels[field] ?? null,
  };
}

function withColor(ctx: Ctx, enc: VlSpec, field = "color"): VlSpec {
  return ctx.hasColor ? { ...enc, color: colorEnc(ctx, field) } : enc;
}

function fixedColor(ctx: Ctx): string {
  return ctx.colors[0];
}

function dataLabelLayer(ctx: Ctx, enc: VlSpec, field: string, extra: VlSpec = {}): VlSpec[] {
  if (!ctx.c.data_labels) return [];
  return [
    {
      transform: [only("main")],
      mark: { type: "text", dy: -8, color: ctx.ink, fontSize: Math.max(9, (ctx.c.font_size ?? 12) - 2), ...extra },
      encoding: { ...enc, text: { field, type: "quantitative", format: ".2f" } },
    },
  ];
}

// ---- chart builders ---------------------------------------------------------------------------

function means(ctx: Ctx): Built {
  const { data } = ctx;
  const t = ctx.spec.chart_type;
  const lineLike = t === "line" || t === "interaction";
  const hasX = data.rows.some((r) => r.x !== undefined && r.x !== null);
  const errKind = (data.meta.error_bars ?? "none") as keyof typeof ERROR_LABEL | "none";
  const valueTitle = data.meta.labels?.value ?? "Value";
  const yAxisTitle = yTitle(ctx, errKind !== "none" ? `${valueTitle} (error bars: ${ERROR_LABEL[errKind]})` : valueTitle);
  const x: VlSpec | undefined = hasX
    ? { field: "x", type: lineLike && t === "line" ? "ordinal" : "nominal", sort: ctx.levels.x ?? null, title: xTitle(ctx, ctx.labels.x), axis: { labelAngle: 0 }, scale: lineLike ? { padding: 0.3 } : undefined }
    : undefined;
  const y: VlSpec = { field: "value", type: "quantitative", title: yAxisTitle, scale: axisScale(ctx.c.y_axis) };
  const offset = !lineLike && ctx.hasColor ? { xOffset: { field: "color", sort: ctx.levels.color ?? null } } : {};
  const base: VlSpec = { ...(x ? { x } : {}), ...offset };
  const tooltip = [
    ...(hasX ? [{ field: "x", title: ctx.labels.x ?? "Group" }] : []),
    ...(ctx.hasColor ? [{ field: "color", title: ctx.labels.color ?? "Group" }] : []),
    { field: "value", type: "quantitative", title: valueTitle, format: ".2f" },
    { field: "n", type: "quantitative", title: "n" },
    ...(errKind !== "none"
      ? [
          { field: "lower", type: "quantitative", title: "Lower", format: ".2f" },
          { field: "upper", type: "quantitative", title: "Upper", format: ".2f" },
        ]
      : []),
  ];
  const layers: VlSpec[] = [];
  const greyLines = ctx.c.greyscale && ctx.hasColor;
  if (lineLike) {
    const enc = withColor(ctx, { ...base, y, tooltip, ...(ctx.hasColor ? { detail: { field: "color" } } : {}) });
    if (greyLines) enc.strokeDash = { field: "color", type: "nominal", sort: ctx.levels.color ?? null, legend: null };
    layers.push({ transform: [only("main")], mark: { type: "line", strokeWidth: 2, ...(ctx.hasColor ? {} : { color: fixedColor(ctx) }) }, encoding: enc });
    const penc = withColor(ctx, { ...base, y, tooltip });
    if (greyLines) penc.shape = { field: "color", type: "nominal", sort: ctx.levels.color ?? null, legend: null };
    layers.push({ transform: [only("main")], mark: { type: "point", filled: true, size: 60, ...(ctx.hasColor ? {} : { color: fixedColor(ctx) }) }, encoding: penc });
  } else {
    layers.push({
      transform: [only("main")],
      mark: { type: "bar", ...(ctx.hasColor ? {} : { color: fixedColor(ctx) }), ...(ctx.apa ? { stroke: ctx.ink, strokeWidth: 0.75 } : {}) },
      encoding: withColor(ctx, { ...base, y, tooltip }),
    });
  }
  if (errKind !== "none") {
    const eb: VlSpec = { ...base, y: { field: "lower", type: "quantitative" }, y2: { field: "upper" } };
    layers.push({ transform: [only("main"), { filter: "isValid(datum.lower)" }], mark: { type: "rule", color: ctx.ink, strokeWidth: 1.25 }, encoding: eb });
    for (const f of ["lower", "upper"]) {
      layers.push({
        transform: [only("main"), { filter: "isValid(datum.lower)" }],
        mark: { type: "tick", color: ctx.ink, thickness: 1.25, size: 10, orient: "horizontal" },
        encoding: { ...base, y: { field: f, type: "quantitative" } },
      });
    }
  }
  layers.push(...dataLabelLayer(ctx, { ...base, y }, "value", errKind !== "none" && !lineLike ? { dx: 14, dy: -6 } : {}));
  return { layers };
}

function counts(outer: Ctx): Built {
  const percent = outer.spec.chart_type === "percent_bar";
  const field = percent ? "percent" : "count";
  const horizontal = outer.data.meta.labels?.x === "Item";
  // Survey items: responses are ordered, so they get the diverging disagree -> agree colors.
  const ordered = horizontal && outer.c.palette !== "custom";
  const ctx: Ctx = ordered ? { ...outer, colors: divergingColors(outer.levels.color?.length ?? 2, !!outer.c.greyscale, outer.theme) } : outer;
  const cat: VlSpec = { field: "x", type: "nominal", sort: ctx.levels.x ?? null, title: (horizontal ? yTitle : xTitle)(ctx, ctx.labels.x), axis: horizontal ? {} : { labelAngle: 0 } };
  const val: VlSpec = {
    field,
    type: "quantitative",
    stack: "zero",
    title: (horizontal ? xTitle : yTitle)(ctx, percent ? "Percent" : "Count"),
    scale: axisScale(horizontal ? ctx.c.x_axis : ctx.c.y_axis, percent ? { domain: [0, 100] } : {}),
  };
  const enc: VlSpec = horizontal ? { y: cat, x: val } : { x: cat, y: val };
  enc.tooltip = [
    { field: "x", title: ctx.labels.x ?? "Group" },
    ...(ctx.hasColor ? [{ field: "color", title: ctx.labels.color ?? "Category" }] : []),
    { field: "count", type: "quantitative", title: "Count" },
    { field: "percent", type: "quantitative", title: "Percent", format: ".1f" },
  ];
  if (ctx.hasColor) enc.order = { field: "_ci", type: "quantitative" };
  const layers: VlSpec[] = [
    { transform: [only("main")], mark: { type: "bar", ...(ctx.hasColor ? {} : { color: fixedColor(ctx) }), ...(ctx.apa ? { stroke: ctx.ink, strokeWidth: 0.5 } : {}) }, encoding: withColor(ctx, enc) },
  ];
  if (ctx.c.data_labels) {
    layers.push({
      transform: [only("main"), { filter: `datum.${field} > 0` }],
      mark: { type: "text", color: ctx.ink, fontSize: 10, ...(horizontal ? { dx: 0 } : { dy: 0 }) },
      encoding: { ...(horizontal ? { y: cat, x: { ...val, bandPosition: 0.5 } } : { x: cat, y: val }), order: enc.order, text: { field, type: "quantitative", format: percent ? ".0f" : "d" } },
    });
  }
  return { layers, height: horizontal ? Math.max(120, (ctx.levels.x?.length ?? 1) * 26) : undefined };
}

function likert(ctx: Ctx): Built {
  const responses = ctx.levels.response ?? [];
  const range = divergingColors(responses.length, !!ctx.c.greyscale, ctx.theme);
  const y: VlSpec = { field: "item", type: "nominal", sort: ctx.levels.item ?? null, title: yTitle(ctx, null), axis: { labelLimit: 260 } };
  const layers: VlSpec[] = [
    {
      transform: [only("main")],
      mark: { type: "bar", ...(ctx.apa ? { stroke: ctx.ink, strokeWidth: 0.4 } : {}) },
      encoding: {
        y,
        x: { field: "start", type: "quantitative", title: xTitle(ctx, "Percent of responses"), axis: { labelExpr: "abs(datum.value) + '%'" }, scale: axisScale(ctx.c.x_axis) },
        x2: { field: "end" },
        color: {
          field: "response",
          type: "ordinal",
          sort: responses,
          scale: { domain: responses, range },
          legend: ctx.legend ? { ...ctx.legend, title: ctx.labels.response ?? "Response" } : null,
        },
        tooltip: [
          { field: "item", title: "Item" },
          { field: "response", title: "Response" },
          { field: "count", type: "quantitative", title: "Count" },
          { field: "percent", type: "quantitative", title: "Percent", format: ".1f" },
        ],
      },
    },
    { mark: { type: "rule", color: ctx.ink, strokeWidth: 1 }, encoding: { x: { datum: 0 } } },
  ];
  if (ctx.c.data_labels) {
    layers.push({
      transform: [only("main"), { filter: "datum.percent >= 6" }, { calculate: "(datum.start + datum.end) / 2", as: "_mid" }],
      mark: { type: "text", fontSize: 10, color: "#111111" },
      encoding: { y, x: { field: "_mid", type: "quantitative" }, text: { field: "percent", type: "quantitative", format: ".0f" } },
    });
  }
  return { layers, height: Math.max(120, (ctx.levels.item?.length ?? 1) * 28) };
}

function histogram(ctx: Ctx): Built {
  const enc: VlSpec = {
    x: { field: "bin_start", type: "quantitative", bin: { binned: true }, title: xTitle(ctx, ctx.labels.value), scale: axisScale(ctx.c.x_axis) },
    x2: { field: "bin_end" },
    y: { field: "count", type: "quantitative", title: yTitle(ctx, "Number of people"), stack: ctx.hasColor ? null : "zero", scale: axisScale(ctx.c.y_axis) },
    tooltip: [
      { field: "bin_start", type: "quantitative", title: "From", format: ".2f" },
      { field: "bin_end", type: "quantitative", title: "To", format: ".2f" },
      { field: "count", type: "quantitative", title: "Count" },
      ...(ctx.hasColor ? [{ field: "color", title: ctx.labels.color ?? "Group" }] : []),
    ],
  };
  const layers: VlSpec[] = [
    {
      transform: [only("main")],
      mark: { type: "bar", binSpacing: 0, stroke: ctx.apa ? ctx.ink : ctx.surface === "transparent" ? (ctx.theme === "dark" ? "#0a0a0a" : "#ffffff") : ctx.surface, strokeWidth: ctx.apa ? 0.75 : 1.5, opacity: ctx.hasColor ? 0.6 : 1, ...(ctx.hasColor ? {} : { color: fixedColor(ctx) }) },
      encoding: withColor(ctx, enc),
    },
  ];
  if (ctx.c.data_labels) {
    layers.push({
      transform: [only("main"), { filter: "datum.count > 0" }, { calculate: "(datum.bin_start + datum.bin_end) / 2", as: "_mid" }],
      mark: { type: "text", dy: -6, fontSize: 9, color: ctx.ink },
      encoding: { x: { field: "_mid", type: "quantitative" }, y: { field: "count", type: "quantitative" }, text: { field: "count", type: "quantitative" } },
    });
  }
  return { layers };
}

function density(ctx: Ctx): Built {
  const enc: VlSpec = {
    x: { field: "x", type: "quantitative", title: xTitle(ctx, ctx.labels.value), scale: axisScale(ctx.c.x_axis, { zero: false }) },
    y: { field: "density", type: "quantitative", title: yTitle(ctx, "Density"), scale: axisScale(ctx.c.y_axis) },
    ...(ctx.hasColor ? { detail: { field: "color" } } : {}),
  };
  const fill = ctx.hasColor ? {} : { color: fixedColor(ctx) };
  return {
    layers: [
      { transform: [only("main")], mark: { type: "area", opacity: 0.22, ...fill }, encoding: withColor(ctx, { ...enc, y: { ...(enc.y as VlSpec), stack: null } }) },
      { transform: [only("main")], mark: { type: "line", strokeWidth: 2, ...fill }, encoding: withColor(ctx, enc) },
    ],
  };
}

function groupKeys(r: Record<string, unknown>): ChartRow {
  const out: ChartRow = {};
  for (const k of ["color", "facet", "facet2"]) if (r[k] !== undefined) out[k] = r[k] as string;
  return out;
}

function qq(ctx: Ctx): Built {
  const extra: ChartRow[] = [];
  for (const l of ctx.data.meta.lines ?? []) {
    for (const t of [l.x_min, l.x_max]) extra.push({ ...groupKeys(l), _layer: "line", theoretical: t, sample: l.intercept + l.slope * t });
  }
  const c = CHART_COLORS[ctx.theme];
  const x = { field: "theoretical", type: "quantitative", title: xTitle(ctx, "Expected if normal (z)"), scale: axisScale(ctx.c.x_axis) };
  const y = { field: "sample", type: "quantitative", title: yTitle(ctx, `Observed ${ctx.labels.value ?? "score"}`), scale: axisScale(ctx.c.y_axis, { zero: false }) };
  return {
    extra,
    layers: [
      {
        transform: [only("line")],
        mark: { type: "line", strokeWidth: 1.75, strokeDash: [6, 4], ...(ctx.hasColor ? {} : { color: ctx.apa ? ctx.ink : c.reference }) },
        encoding: withColor(ctx, { x, y, ...(ctx.hasColor ? { detail: { field: "color" } } : {}) }),
      },
      {
        transform: [only("main")],
        mark: { type: "point", filled: true, size: 40, opacity: 0.85, ...(ctx.hasColor ? {} : { color: fixedColor(ctx) }) },
        encoding: withColor(ctx, {
          x,
          y,
          tooltip: [
            { field: "theoretical", type: "quantitative", title: "Expected (z)", format: ".2f" },
            { field: "sample", type: "quantitative", title: "Observed", format: ".2f" },
          ],
        }),
      },
    ],
  };
}

function box(ctx: Ctx): Built {
  const hasX = ctx.data.rows.some((r) => r.x !== undefined);
  const x: VlSpec = hasX ? { x: { field: "x", type: "nominal", sort: ctx.levels.x ?? null, title: xTitle(ctx, ctx.labels.x), axis: { labelAngle: 0 } } } : {};
  const off = ctx.hasColor ? { xOffset: { field: "color", sort: ctx.levels.color ?? null } } : {};
  const scale = axisScale(ctx.c.y_axis, { zero: false });
  const yt = yTitle(ctx, ctx.labels.value);
  const col = ctx.hasColor ? {} : { color: fixedColor(ctx) };
  const enc = (e: VlSpec) => withColor(ctx, { ...x, ...off, ...e });
  const boxOnly = [only("main"), kindIs("box")];
  const tooltip = [
    ...(hasX ? [{ field: "x", title: ctx.labels.x ?? "Group" }] : []),
    { field: "median", type: "quantitative", title: "Median", format: ".2f" },
    { field: "q1", type: "quantitative", title: "Q1", format: ".2f" },
    { field: "q3", type: "quantitative", title: "Q3", format: ".2f" },
    { field: "n", type: "quantitative", title: "n" },
  ];
  return {
    layers: [
      { transform: boxOnly, mark: { type: "rule", strokeWidth: 1.25, ...col }, encoding: enc({ y: { field: "whisker_low", type: "quantitative", title: yt, scale }, y2: { field: "q1" } }) },
      { transform: boxOnly, mark: { type: "rule", strokeWidth: 1.25, ...col }, encoding: enc({ y: { field: "q3", type: "quantitative" }, y2: { field: "whisker_high" } }) },
      {
        transform: boxOnly,
        mark: { type: "bar", size: ctx.hasColor ? 16 : 32, fillOpacity: ctx.c.greyscale ? 0.15 : 0.35, strokeWidth: 1.5, ...col, ...(ctx.hasColor ? {} : { stroke: fixedColor(ctx) }) },
        encoding: { ...enc({ y: { field: "q1", type: "quantitative" }, y2: { field: "q3" }, tooltip }), ...(ctx.hasColor ? { stroke: colorEnc(ctx) } : {}) },
      },
      { transform: boxOnly, mark: { type: "tick", thickness: 2.5, size: ctx.hasColor ? 16 : 32, orient: "horizontal", ...col }, encoding: enc({ y: { field: "median", type: "quantitative" } }) },
      {
        transform: [only("main"), kindIs("outlier")],
        mark: { type: "point", size: 30, strokeWidth: 1.25, ...col },
        encoding: enc({ y: { field: "value", type: "quantitative" }, tooltip: [{ field: "value", type: "quantitative", title: "Unusual score", format: ".2f" }] }),
      },
    ],
  };
}

function violin(ctx: Ctx): Built {
  const rows = ctx.data.rows;
  const hasX = rows.some((r) => r.x !== undefined);
  const maxD = Math.max(1e-9, ...rows.filter((r) => r.kind === "density").map((r) => Number(r.density)));
  const bw = maxD * 0.14;
  // Fill: the color shelf if used, else the X grouping, else one color.
  const fillField = ctx.hasColor ? "color" : hasX ? "x" : null;
  const colorFor = fillField ? { color: colorEnc(ctx, fillField) } : {};
  const col = fillField ? {} : { color: fixedColor(ctx) };
  const scale = axisScale(ctx.c.y_axis, { zero: false });
  const y = { field: "value", type: "quantitative", title: yTitle(ctx, ctx.labels.value), scale };
  const xq = { type: "quantitative", scale: { domain: [-maxD * 1.05, maxD * 1.05] }, axis: null, title: null };
  const boxOnly = [only("main"), kindIs("box")];
  const nCols = Math.max(1, ctx.levels.x?.length ?? 1);
  const facet: VlSpec | null = hasX || rows.some((r) => r.facet !== undefined)
    ? {
        ...(hasX ? { column: { field: "x", type: "nominal", sort: ctx.levels.x ?? null, title: xTitle(ctx, ctx.labels.x), header: { labelOrient: "bottom", titleOrient: "bottom" } } } : {}),
        ...(rows.some((r) => r.facet !== undefined) ? { row: { field: "facet", type: "nominal", sort: ctx.levels.facet ?? null, title: ctx.labels.facet ?? null } } : {}),
      }
    : null;
  return {
    facet,
    width: Math.max(60, Math.min(180, Math.floor(ctx.width / nCols))),
    layers: [
      {
        transform: [only("main"), kindIs("density"), { calculate: "-datum.density", as: "_neg" }],
        mark: { type: "area", orient: "horizontal", opacity: ctx.c.greyscale ? 0.25 : 0.45, ...col, ...(ctx.apa ? { stroke: ctx.ink, strokeWidth: 0.75 } : {}) },
        encoding: { y, x: { field: "_neg", ...xq }, x2: { field: "density" }, ...colorFor },
      },
      { transform: boxOnly, mark: { type: "rule", color: ctx.ink, strokeWidth: 1 }, encoding: { x: { datum: 0, ...xq }, y: { field: "whisker_low", type: "quantitative" }, y2: { field: "whisker_high" } } },
      {
        transform: boxOnly,
        mark: { type: "rect", color: ctx.ink, opacity: 0.85 },
        encoding: { x: { datum: -bw, ...xq }, x2: { datum: bw }, y: { field: "q1", type: "quantitative" }, y2: { field: "q3" }, tooltip: [{ field: "median", type: "quantitative", title: "Median", format: ".2f" }, { field: "n", type: "quantitative", title: "n" }] },
      },
      { transform: boxOnly, mark: { type: "point", filled: true, size: 26, color: ctx.theme === "dark" && !ctx.apa ? "#111111" : "#ffffff" }, encoding: { x: { datum: 0, ...xq }, y: { field: "median", type: "quantitative" } } },
    ],
  };
}

function scatter(ctx: Ctx): Built {
  const extra: ChartRow[] = [];
  for (const f of ctx.data.meta.fits ?? []) for (const p of f.points ?? []) extra.push({ ...groupKeys(f as never), _layer: "fit", x: p.x, y: p.y });
  const x = { field: "x", type: "quantitative", title: xTitle(ctx, ctx.labels.x), scale: axisScale(ctx.c.x_axis, { zero: false }) };
  const y = { field: "y", type: "quantitative", title: yTitle(ctx, ctx.labels.y), scale: axisScale(ctx.c.y_axis, { zero: false }) };
  const c = CHART_COLORS[ctx.theme];
  return {
    extra,
    layers: [
      {
        transform: [only("main")],
        mark: { type: "point", filled: true, size: 36, opacity: 0.7, ...(ctx.hasColor ? {} : { color: fixedColor(ctx) }) },
        encoding: withColor(ctx, { x, y, tooltip: [{ field: "x", type: "quantitative", title: ctx.labels.x, format: ".2f" }, { field: "y", type: "quantitative", title: ctx.labels.y, format: ".2f" }] }),
      },
      {
        transform: [only("fit")],
        mark: { type: "line", strokeWidth: 2.25, ...(ctx.hasColor ? {} : { color: ctx.apa ? ctx.ink : c.reference }) },
        encoding: withColor(ctx, { x, y, ...(ctx.hasColor ? { detail: { field: "color" } } : {}) }),
      },
    ],
  };
}

function heatmap(ctx: Ctx): Built {
  const n = ctx.levels.col?.length ?? 1;
  const cell = n > 12 ? 26 : 40;
  const x = { field: "col", type: "nominal", sort: ctx.levels.col ?? null, title: xTitle(ctx, null), axis: { labelAngle: -45, labelLimit: 140 } };
  const y = { field: "row", type: "nominal", sort: ctx.levels.row ?? null, title: yTitle(ctx, null), axis: { labelLimit: 160 } };
  const scale = ctx.c.greyscale ? { domain: [-1, 0, 1], range: ["#1a1a1a", "#ffffff", "#1a1a1a"] } : { domain: [-1, 1], scheme: "blueorange", reverse: true };
  const layers: VlSpec[] = [
    {
      transform: [only("main")],
      mark: { type: "rect", stroke: ctx.theme === "dark" && !ctx.apa ? "#1f1f1e" : "#ffffff", strokeWidth: 1 },
      encoding: {
        x,
        y,
        color: { field: "r", type: "quantitative", scale, title: ctx.data.meta.labels?.value ?? "r", legend: ctx.legend ? { ...ctx.legend, gradientLength: Math.min(200, n * cell) } : null },
        tooltip: [
          { field: "row", title: "Variable" },
          { field: "col", title: "With" },
          { field: "r", type: "quantitative", title: "r", format: ".2f" },
          { field: "n", type: "quantitative", title: "n" },
        ],
      },
    },
  ];
  if (ctx.c.data_labels !== false && n <= 15) {
    layers.push({
      transform: [only("main")],
      mark: { type: "text", fontSize: n > 10 ? 9 : 11 },
      encoding: {
        x,
        y,
        text: { field: "_label" },
        color: { condition: { test: "abs(datum.r) > 0.55", value: "#ffffff" }, value: "#111111" },
      },
    });
  }
  return { layers, width: n * cell, height: n * cell };
}

function scree(ctx: Ctx): Built {
  const series = ctx.levels.series ?? [];
  const x = { field: "number", type: "quantitative", title: xTitle(ctx, "Factor number"), axis: { tickMinStep: 1, format: "d" }, scale: axisScale(ctx.c.x_axis, { zero: false }) };
  const y = { field: "eigenvalue", type: "quantitative", title: yTitle(ctx, "Eigenvalue"), scale: axisScale(ctx.c.y_axis) };
  const color = { field: "series", type: "nominal", sort: series, scale: { domain: series, range: ctx.colors }, legend: ctx.legend ? { ...ctx.legend, title: null } : null };
  const dash = { field: "series", type: "nominal", sort: series, scale: { domain: series, range: [[1, 0], [4, 2], [6, 4]] }, legend: null };
  const tooltip = [{ field: "series", title: "Series" }, { field: "number", title: "Factor" }, { field: "eigenvalue", type: "quantitative", title: "Eigenvalue", format: ".3f" }];
  return {
    layers: [
      { mark: { type: "rule", color: ctx.muted, strokeDash: [2, 3] }, encoding: { y: { datum: 1 } } },
      { transform: [only("main")], mark: { type: "line", strokeWidth: 2 }, encoding: { x, y, color, strokeDash: dash, tooltip } },
      { transform: [only("main")], mark: { type: "point", filled: true, size: 45 }, encoding: { x, y, color, shape: { field: "series", type: "nominal", sort: series, legend: null }, tooltip } },
    ],
  };
}

function cfaPath(ctx: Ctx): Built {
  const nItems = Number(ctx.data.meta.n_items ?? 1);
  const xs = { type: "quantitative", scale: { domain: [-0.7, nItems - 0.3] }, axis: null, title: null };
  const ys = { type: "quantitative", scale: { domain: [-0.75, 1.55], reverse: true }, axis: null, title: null };
  const surface = ctx.theme === "dark" && !ctx.apa ? "#1f1f1e" : "#ffffff";
  const accent = ctx.apa || ctx.c.greyscale ? ctx.ink : ctx.colors[0];
  const node = (type: string) => [only("main"), kindIs("node"), { filter: { field: "node_type", equal: type } }];
  const loading = [only("main"), kindIs("edge"), { filter: { field: "edge_type", equal: "loading" } }];
  const edgeLabels = [only("main"), kindIs("edge"), { filter: "isValid(datum.label)" }];
  return {
    width: Math.max(360, nItems * 72),
    height: 280,
    layers: [
      {
        transform: loading,
        mark: { type: "rule", color: accent },
        encoding: {
          x: { field: "x", ...xs },
          y: { field: "y", ...ys },
          x2: { field: "x2" },
          y2: { field: "y2" },
          strokeWidth: { field: "_absw", type: "quantitative", scale: { domain: [0, 1], range: [0.6, 3.5] }, legend: null },
          tooltip: [{ field: "from", title: "Factor" }, { field: "to", title: "Item" }, { field: "label", title: "Standardized loading" }],
        },
      },
      {
        transform: [only("main"), kindIs("curve")],
        mark: { type: "line", color: ctx.muted, strokeWidth: 1.5, interpolate: "monotone" },
        encoding: { x: { field: "x", ...xs }, y: { field: "y", ...ys }, detail: { field: "id" }, order: { field: "order", type: "quantitative" } },
      },
      { transform: node("latent"), mark: { type: "point", shape: "circle", size: 3600, filled: true, color: surface, stroke: ctx.ink, strokeWidth: 1.5, opacity: 1 }, encoding: { x: { field: "x", ...xs }, y: { field: "y", ...ys } } },
      { transform: node("observed"), mark: { type: "square", size: 1100, filled: true, color: surface, stroke: ctx.ink, strokeWidth: 1.25, opacity: 1 }, encoding: { x: { field: "x", ...xs }, y: { field: "y", ...ys } } },
      { transform: [only("main"), kindIs("node")], mark: { type: "text", color: ctx.ink, fontSize: 10, limit: 70 }, encoding: { x: { field: "x", ...xs }, y: { field: "y", ...ys }, text: { field: "label" }, tooltip: [{ field: "label", title: "Name" }] } },
      { transform: edgeLabels, mark: { type: "text", color: ctx.ink, fontSize: 10, fontWeight: "bold", dx: 10 }, encoding: { x: { field: "label_x", ...xs }, y: { field: "label_y", ...ys }, text: { field: "label" } } },
      {
        transform: [...node("observed"), { filter: "isValid(datum.residual_label)" }, { calculate: "datum.y + 0.32", as: "_ry" }],
        mark: { type: "text", color: ctx.muted, fontSize: 9 },
        encoding: { x: { field: "x", ...xs }, y: { field: "_ry", ...ys }, text: { field: "residual_label" }, tooltip: [{ field: "residual", type: "quantitative", title: "Residual variance (std.)", format: ".2f" }] },
      },
    ],
  };
}

const BUILDERS: Record<ChartSpec["chart_type"], (ctx: Ctx) => Built> = {
  bar: means,
  grouped_bar: means,
  line: means,
  interaction: means,
  stacked_bar: counts,
  percent_bar: counts,
  likert_diverging: likert,
  histogram,
  density,
  qq,
  box,
  violin,
  scatter,
  correlation_heatmap: heatmap,
  scree,
  cfa_path: cfaPath,
};

/** Default chart title from the data labels (used when the user hasn't typed one). */
export function autoTitle(spec: ChartSpec, data: ChartsDataResult | null): string {
  const l = data?.meta.labels ?? {};
  const t = spec.chart_type;
  const by = (s: string) => (l.x ? `${s} by ${l.x}` : s);
  switch (t) {
    case "bar":
    case "grouped_bar":
      return by(l.value ?? "Averages") + (l.color && spec.shelves.color.length ? ` and ${l.color}` : "");
    case "line":
    case "interaction":
      return by(l.value ?? "Averages") + (l.color && spec.shelves.color.length ? ` for each ${l.color}` : "");
    case "histogram":
    case "density":
      return `Distribution of ${l.value ?? "scores"}`;
    case "qq":
      return `Normal Q-Q plot of ${l.value ?? "scores"}`;
    case "box":
    case "violin":
      return l.x ? `${l.value ?? "Scores"} by ${l.x}` : `${l.value ?? "Scores"}`;
    case "scatter":
      return l.x && l.y ? `${l.y} and ${l.x}` : "Scatter plot";
    case "correlation_heatmap":
      return "Correlations between variables";
    case "likert_diverging":
      return "Responses to each item";
    case "stacked_bar":
    case "percent_bar":
      return l.x === "Item" ? "Responses to each item" : l.color ? `${l.color} within each ${l.x ?? "group"}` : `Count by ${l.x ?? "group"}`;
    case "scree":
      return "Scree plot with parallel analysis";
    case "cfa_path":
      return "Confirmatory factor analysis: standardized loadings";
  }
}

function prepareRows(ctx: Ctx, rows: ChartRow[]): ChartRow[] {
  const ci = new Map((ctx.levels.color ?? []).map((c, i) => [c, i]));
  const t = ctx.spec.chart_type;
  return rows.map((r) => {
    const out: ChartRow = { ...r, _layer: "main" };
    if (r.color !== undefined) out._ci = ci.get(String(r.color)) ?? 0;
    if (t === "correlation_heatmap") out._label = apaNum(r.r as number | null);
    if (t === "cfa_path" && r.kind === "edge") out._absw = Math.abs(Number(r.weight ?? 0));
    return out;
  });
}

export interface CompileOptions {
  theme: ResolvedTheme;
}

/** Compile a ChartSpec and its engine data to a Vega-Lite spec. */
export function compileChart(spec: ChartSpec, data: ChartsDataResult, opts: CompileOptions): VlSpec {
  const c = (spec.customization ?? {}) as BuilderCustomization;
  const apa = spec.theme_preset === "apa";
  const theme = opts.theme;
  const base = CHART_COLORS[theme];
  const ink = apa ? (theme === "dark" ? "#f5f5f5" : "#000000") : base.ink;
  const muted = apa ? ink : base.muted;
  const levels = data.meta.levels ?? {};
  const labels = data.meta.labels ?? {};
  const hasColor = data.rows.some((r) => r.color !== undefined && r.color !== null);
  const seriesField = spec.chart_type === "scree" ? "series" : spec.chart_type === "violin" && !hasColor ? "x" : "color";
  const nSeries = Math.max(1, levels[seriesField]?.length ?? 1);
  const palette = c.greyscale ? "greyscale" : c.palette;
  const colors = paletteColors(palette, theme, nSeries, c.custom_colors);
  const pos = c.legend_position ?? (apa || spec.chart_type === "likert_diverging" ? "bottom" : "right");
  const legend = pos === "none" ? null : { orient: pos, direction: pos === "top" || pos === "bottom" ? "horizontal" : "vertical" };
  const width = c.width ?? DEFAULT_SIZE.width;
  const height = c.height ?? DEFAULT_SIZE.height;
  const ctx: Ctx = { spec, data, theme, c, apa, ink, muted, surface: base.surface, levels, labels, colors, legend, hasColor, width, height };

  const built = BUILDERS[spec.chart_type](ctx);
  const values = [...prepareRows(ctx, data.rows), ...(built.extra ?? [])];
  const inner: VlSpec = built.layers.length === 1 ? { ...built.layers[0] } : { layer: built.layers };

  const hasFacet = data.rows.some((r) => r.facet !== undefined);
  const hasFacet2 = data.rows.some((r) => r.facet2 !== undefined);
  let facet: VlSpec | null = null;
  if (built.facet !== undefined) facet = built.facet;
  else if (hasFacet) {
    facet = {
      column: { field: "facet", type: "nominal", sort: levels.facet ?? null, title: labels.facet ?? null },
      ...(hasFacet2 ? { row: { field: "facet2", type: "nominal", sort: levels.facet2 ?? null, title: labels.facet2 ?? null } } : {}),
    };
  }
  const nFacetCols = facet && hasFacet && built.facet === undefined ? Math.max(1, levels.facet?.length ?? 1) : 1;
  const w = built.width ?? Math.max(120, Math.floor(width / nFacetCols));
  const h = built.height ?? (hasFacet2 ? Math.max(100, Math.floor(height / Math.max(1, levels.facet2?.length ?? 1))) : height);

  const chart: VlSpec = facet
    ? { data: { values }, facet, spec: { width: w, height: h, ...inner }, ...(built.resolve ? { resolve: built.resolve } : {}) }
    : { data: { values }, width: w, height: h, ...inner, ...(built.resolve ? { resolve: built.resolve } : {}) };

  const fontSize = c.font_size ?? 12;
  const font = c.font_family || (apa ? APA_FONT : DEFAULT_FONT);
  const userTitle = c.title ?? autoTitle(spec, data);
  const gridlines = c.gridlines ?? !apa;
  const config: VlSpec = {
    background: base.surface,
    font,
    view: { stroke: null },
    axis: {
      labelColor: apa ? ink : base.muted,
      titleColor: ink,
      domainColor: apa ? ink : base.grid,
      tickColor: apa ? ink : base.grid,
      gridColor: base.grid,
      grid: gridlines,
      labelFontSize: fontSize - 1,
      titleFontSize: fontSize,
      titleFontWeight: apa ? "normal" : 500,
      labelFont: font,
      titleFont: font,
    },
    axisBand: { grid: false },
    legend: { labelLimit: 260, labelColor: ink, titleColor: ink, labelFontSize: fontSize - 1, titleFontSize: fontSize, titleFontWeight: apa ? "normal" : 500, labelFont: font, titleFont: font },
    header: { labelColor: ink, titleColor: ink, labelFontSize: fontSize - 1, titleFontSize: fontSize, labelFont: font, titleFont: font },
    title: { color: ink, subtitleColor: apa ? ink : base.muted, fontSize: fontSize + 1, subtitleFontSize: fontSize, anchor: "start", font, subtitleFont: font },
    text: { font },
  };
  const title: VlSpec = apa
    ? { text: `Figure ${c.figure_number ?? 1}`, subtitle: userTitle, fontWeight: "bold", subtitleFontStyle: "italic", subtitlePadding: 6, offset: 12 }
    : { text: userTitle, ...(c.subtitle ? { subtitle: c.subtitle } : {}), fontWeight: 600, offset: 10 };

  const note = (c.figure_note ?? "").trim();
  const out: VlSpec = { $schema: VL_SCHEMA, description: userTitle, title, config, padding: 8 };
  if (!note) return { ...out, ...chart };
  const noteText = apa ? `Note. ${note}` : note;
  return {
    ...out,
    vconcat: [
      chart,
      {
        data: { values: [{ t: noteText }] },
        width: facet ? w * nFacetCols : w,
        height: 16,
        mark: { type: "text", align: "left", baseline: "top", color: ink, fontSize: fontSize - 1, limit: Math.max(200, (facet ? w * nFacetCols : w) + 60), lineBreak: "\n" },
        encoding: { x: { value: 0 }, y: { value: 0 }, text: { field: "t" } },
      },
    ],
    spacing: 14,
  };
}
