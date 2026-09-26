/**
 * Renders a chart off-screen with vega-embed (same spec builder as components/charts/VegaChart) and
 * reads back PNG/SVG bytes, for "Save figure…" (SPEC §10.3). Self-contained rather than depending on
 * a chart component's DOM node, so it works for any chart_type/rows pair, including ones no
 * currently-mounted chart is showing (e.g. a Report export rendering a result nobody has open).
 */
import type { ChartType } from "@/contracts";
import { chartSpec } from "@/lib/chartSpecs";

type Row = Record<string, number | string | boolean | null>;
type Theme = "light" | "dark";

export const PNG_SCALES = [1, 2, 4] as const;
export type PngScale = (typeof PNG_SCALES)[number];

/** Vega's default export resolution is 150 DPI per scale factor of 1, so 1x/2x/4x span 150-600 DPI. */
const BASE_DPI = 150;
export function dpiFor(scale: PngScale): number {
  return BASE_DPI * scale;
}

async function withView<T>(
  type: ChartType,
  rows: Row[],
  theme: Theme,
  title: string,
  fn: (view: { toImageURL: (t: string, scale?: number) => Promise<string>; toSVG: () => Promise<string> }) => Promise<T>,
): Promise<T> {
  const spec = chartSpec(type, rows, theme, title);
  if (!spec) throw new Error("This chart can't be exported.");
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-9999px";
  host.style.top = "0";
  document.body.appendChild(host);
  try {
    const [{ default: embed }, { expressionInterpreter }] = await Promise.all([import("vega-embed"), import("vega-interpreter")]);
    const res = await embed(host, spec as never, { actions: false, renderer: "canvas", ast: true, expr: expressionInterpreter });
    try {
      return await fn(res.view as never);
    } finally {
      res.finalize();
    }
  } finally {
    host.remove();
  }
}

/** A `data:image/png;base64,...` URL at the given scale (1x/2x/4x -> 150/300/600 DPI). */
export async function chartPngDataUrl(type: ChartType, rows: Row[], theme: Theme, title: string, scale: PngScale): Promise<string> {
  return withView(type, rows, theme, title, (view) => view.toImageURL("png", scale));
}

/** Standalone SVG markup for the chart. */
export async function chartSvg(type: ChartType, rows: Row[], theme: Theme, title: string): Promise<string> {
  return withView(type, rows, theme, title, (view) => view.toSVG());
}

export function pngDataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(",", 2)[1] ?? "";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
