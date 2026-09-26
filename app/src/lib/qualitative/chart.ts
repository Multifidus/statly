/** Vega-Lite spec for tag summaries: percent of responses per tag, grouped by group/time level. */
import { vegaConfig, type VlSpec } from "@/lib/chartSpecs";
import type { ResolvedTheme } from "@/stores/theme";
import type { SummaryResult } from "./types";

export interface TagChartRow {
  tag: string;
  group: string;
  percent: number;
  count: number;
  n: number;
}

export function summaryRows(s: SummaryResult): TagChartRow[] {
  const names = new Map(s.tags.map((t) => [t.id, t.name]));
  const blocks = s.by && s.groups.length ? s.groups.map((g) => ({ label: g.label, n: g.n_responses, counts: g.counts })) : [{ label: "All responses", n: s.n_responses, counts: s.overall }];
  return blocks.flatMap((b) =>
    b.counts.map((c) => ({ tag: names.get(c.tag_id) ?? c.tag_id, group: b.label, percent: c.percent ?? 0, count: c.count, n: b.n })),
  );
}

export function summarySpec(s: SummaryResult, theme: ResolvedTheme, title: string): VlSpec {
  const rows = summaryRows(s);
  const grouped = !!s.by && s.groups.length > 0;
  const tagScale = { domain: s.tags.map((t) => t.name), range: s.tags.map((t) => t.color) };
  const tooltip = [
    { field: "tag", title: "Tag" },
    ...(grouped ? [{ field: "group", title: s.by }] : []),
    { field: "count", type: "quantitative", title: "Responses" },
    { field: "n", type: "quantitative", title: "Out of" },
    { field: "percent", type: "quantitative", title: "Percent", format: ".1f" },
  ];
  return {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    description: title,
    width: "container",
    height: 220,
    config: vegaConfig(theme),
    data: { values: rows },
    mark: { type: "bar", cornerRadiusEnd: 2 },
    encoding: {
      x: grouped ? { field: "group", type: "nominal", title: s.by, sort: null, axis: { labelAngle: 0 } } : { field: "tag", type: "nominal", title: "Tag", sort: null, axis: { labelAngle: 0 } },
      ...(grouped ? { xOffset: { field: "tag", type: "nominal", sort: null } } : {}),
      y: { field: "percent", type: "quantitative", title: "Percent of responses", scale: { domain: [0, 100] } },
      color: { field: "tag", type: "nominal", title: "Tag", scale: tagScale, legend: grouped ? { orient: "top" } : null },
      tooltip,
    },
  };
}
