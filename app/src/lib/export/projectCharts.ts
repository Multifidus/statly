/**
 * Renders saved Chart Builder charts (project.chart_specs) for the Export > Report "Project charts"
 * section (SPEC §10.3). Each selected ChartSpec is fetched (`charts.data`, same call the Charts tab
 * makes) and compiled the same way BuilderChart renders it (lib/chartbuilder/compile.ts), then
 * rasterised off-screen (lib/export/figure.ts) so it's included even if nobody has that chart open.
 *
 * Every entry gets a `chart-builder:<spec.id>` request_id so the engine's report renderer
 * (statly_engine/export/report.py `sections()`) never matches it to a logged test's request_id and
 * instead appends it to the trailing "Figures" section, in the order given here.
 */
import type { ChartSpec } from "@/contracts";
import { compileChart } from "@/lib/chartbuilder/compile";
import type { BuilderCustomization } from "@/lib/chartbuilder/types";
import { vlSpecPngDataUrl } from "@/lib/export/figure";
import { chartsRpc } from "@/lib/rpc";
import type { ResolvedTheme } from "@/stores/theme";

export const PROJECT_CHART_REQUEST_PREFIX = "chart-builder:";

export function projectChartRequestId(specId: string): string {
  return `${PROJECT_CHART_REQUEST_PREFIX}${specId}`;
}

/** "Chart" if no title was set, matching components/chartbuilder/ChartsList.tsx's chartName(). */
export function projectChartTitle(spec: ChartSpec): string {
  const t = spec.customization.title;
  return typeof t === "string" && t.trim() ? t : "Chart";
}

/** The report figure's "Note." text: the chart's subtitle and figure note, if either is set. Both
 * are already baked into the rendered image itself (compileChart draws them in the chart's own
 * title block / footer), so this repeats them as the report's standard APA figure note too, the
 * same treatment every other report figure gets. */
function projectChartNote(spec: ChartSpec): string | null {
  const c = spec.customization as BuilderCustomization;
  const parts = [c.subtitle, c.figure_note].map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

export interface RenderedProjectChart {
  request_id: string;
  png_base64: string;
  title: string;
  note: string | null;
}

/** Renders one saved chart to a base64 PNG at the report's DPI (scale 2 = 300 DPI, same as the
 * per-result charts renderCharts() in stores/exportFlow.ts uses). Returns null (skip, don't fail
 * the whole report) if the chart's data can't be fetched or it renders empty. */
export async function renderProjectChart(
  spec: ChartSpec,
  ids: { dataset_id: string | null; snapshot_id: string | null },
  theme: ResolvedTheme,
): Promise<RenderedProjectChart | null> {
  try {
    const data = await chartsRpc.data({ ...ids, spec });
    const vl = compileChart(spec, data, { theme });
    const dataUrl = await vlSpecPngDataUrl(vl, 2);
    return {
      request_id: projectChartRequestId(spec.id),
      png_base64: dataUrl.split(",", 2)[1] ?? "",
      title: projectChartTitle(spec),
      note: projectChartNote(spec),
    };
  } catch {
    return null;
  }
}

export async function renderProjectCharts(
  specs: ChartSpec[],
  ids: { dataset_id: string | null; snapshot_id: string | null },
  theme: ResolvedTheme,
): Promise<RenderedProjectChart[]> {
  const out: RenderedProjectChart[] = [];
  for (const spec of specs) {
    const rendered = await renderProjectChart(spec, ids, theme);
    if (rendered) out.push(rendered);
  }
  return out;
}
