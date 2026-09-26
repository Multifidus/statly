/**
 * Which chart represents a logged result in the Report export (SPEC §10.3). The engine's report
 * renderer keys one figure per section by `inputs.request.request_id` (statly_engine/export/report.py
 * `sections()`), so at most one chart per analysis makes it into the report: the first assumption's
 * first ChartRef that actually has rows in `chart_data`.
 */
import type { AnalysisResult, ChartRef } from "@/contracts";

export function pickReportChart(result: AnalysisResult): ChartRef | null {
  for (const a of result.assumptions ?? []) {
    for (const ref of a.chart_refs ?? []) {
      if ((result.chart_data[ref.data_key]?.length ?? 0) > 0) return ref;
    }
  }
  return null;
}

export function chartRows(result: AnalysisResult, ref: ChartRef): AnalysisResult["chart_data"][string] {
  return result.chart_data[ref.data_key] ?? [];
}

/** Every chart_refs entry across a result's assumptions that has rows, for a "pick which figure"
 * UI (not currently exposed, but selection logic is unit-tested independently of the dialog). */
export function availableCharts(result: AnalysisResult): ChartRef[] {
  const seen = new Set<string>();
  const out: ChartRef[] = [];
  for (const a of result.assumptions ?? []) {
    for (const ref of a.chart_refs ?? []) {
      if (seen.has(ref.data_key) || !(result.chart_data[ref.data_key]?.length ?? 0)) continue;
      seen.add(ref.data_key);
      out.push(ref);
    }
  }
  return out;
}
