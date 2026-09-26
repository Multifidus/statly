/**
 * "Save figure…" (SPEC §10.3): write one chart to disk as PNG (1x/2x/4x), SVG, or PDF. PNG/SVG are
 * pure client-rendered bytes written straight to the chosen path (fs:allow-write-file, dialog-scoped).
 * PDF has no standalone single-image writer in the engine, so it reuses `export.report` with tables,
 * sentences and assumptions turned off: the PDF shows the analysis heading above the figure, using
 * the same Times New Roman renderer as the full report (see docx.py/pdf.py) instead of adding a
 * second, client-side PDF writer.
 *
 * The Chart Builder screen has no AnalysisResult/ChartRef for most chart types (they're built
 * straight from the dataset, not from a logged test), so its "Save figure…" reads bytes off the
 * already-mounted Vega `View` (BuilderChart's `getVegaView()`/`getActiveChartView()`) instead of
 * re-rendering from `chart_data`. The PDF path still goes through `export.report`, with an empty
 * `results` array — the report renderer only needs it for the tables/sentences/assumptions this
 * call turns off.
 */
import type { View } from "vega";
import type { AnalysisResult, ChartRef } from "@/contracts";
import { pickExportPath } from "@/lib/dialogs";
import { chartPngDataUrl, chartSvg, dpiFor, pngDataUrlToBytes, type PngScale } from "@/lib/export/figure";
import { withOverwriteRetry } from "@/lib/export/writeRetry";
import { rpc } from "@/lib/rpc";

/** A filesystem-safe default filename from a chart title, for the save dialog. */
export function filenameFor(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "").trim() || "Chart";
}

export interface SaveFigureResult {
  path: string;
  dpi?: number;
}

const MOCK = () => import.meta.env.VITE_STATLY_MOCK === "1";

export async function saveFigurePng(chart: ChartRef, rows: AnalysisResult["chart_data"][string], theme: "light" | "dark", scale: PngScale, defaultName: string): Promise<SaveFigureResult | null> {
  const path = await pickExportPath(defaultName, "png");
  if (!path) return null;
  const dataUrl = await chartPngDataUrl(chart.chart_type, rows, theme, chart.title, scale);
  if (!MOCK()) {
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await writeFile(path, pngDataUrlToBytes(dataUrl));
  }
  return { path, dpi: dpiFor(scale) };
}

export async function saveFigureSvg(chart: ChartRef, rows: AnalysisResult["chart_data"][string], theme: "light" | "dark", defaultName: string): Promise<SaveFigureResult | null> {
  const path = await pickExportPath(defaultName, "svg");
  if (!path) return null;
  const svg = await chartSvg(chart.chart_type, rows, theme, chart.title);
  if (!MOCK()) {
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(path, svg);
  }
  return { path };
}

export async function saveFigurePdf(result: AnalysisResult, chart: ChartRef, theme: "light" | "dark", defaultName: string): Promise<SaveFigureResult | null> {
  const path = await pickExportPath(defaultName, "pdf");
  if (!path) return null;
  const rows = result.chart_data[chart.data_key] ?? [];
  const dataUrl = await chartPngDataUrl(chart.chart_type, rows, theme, chart.title, 2);
  const b64 = dataUrl.split(",", 2)[1] ?? "";
  await withOverwriteRetry(rpc.exportReport, {
    title: chart.title,
    results: [result],
    include: { tables: false, sentences: false, assumptions: false, charts: true },
    charts: [{ request_id: result.inputs.request.request_id, png_base64: b64, title: chart.title }],
    format: "pdf" as const,
    path,
  });
  return { path };
}

type BuilderView = Pick<View, "toImageURL" | "toSVG">;

/** Chart Builder PNG: bytes straight off the mounted view (no chart_data re-render). */
export async function saveBuilderFigurePng(view: BuilderView, scale: PngScale, defaultName: string): Promise<SaveFigureResult | null> {
  const path = await pickExportPath(defaultName, "png");
  if (!path) return null;
  const dataUrl = await view.toImageURL("png", scale);
  if (!MOCK()) {
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await writeFile(path, pngDataUrlToBytes(dataUrl));
  }
  return { path, dpi: dpiFor(scale) };
}

/** Chart Builder SVG: vector markup straight off the mounted view. */
export async function saveBuilderFigureSvg(view: BuilderView, defaultName: string): Promise<SaveFigureResult | null> {
  const path = await pickExportPath(defaultName, "svg");
  if (!path) return null;
  const svg = await view.toSVG();
  if (!MOCK()) {
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(path, svg);
  }
  return { path };
}

/** Chart Builder PDF: no AnalysisResult exists for a dataset-built chart, so `results` is empty —
 * `export.report` only needs it for the tables/sentences/assumptions this call turns off. */
export async function saveBuilderFigurePdf(view: BuilderView, title: string, defaultName: string): Promise<SaveFigureResult | null> {
  const path = await pickExportPath(defaultName, "pdf");
  if (!path) return null;
  const dataUrl = await view.toImageURL("png", 2);
  const b64 = dataUrl.split(",", 2)[1] ?? "";
  await withOverwriteRetry(rpc.exportReport, {
    title,
    results: [],
    include: { tables: false, sentences: false, assumptions: false, charts: true },
    charts: [{ request_id: "chart-builder", png_base64: b64, title }],
    format: "pdf" as const,
    path,
  });
  return { path };
}
