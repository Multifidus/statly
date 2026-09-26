import { BarChart3, Copy, Plus, Trash2 } from "lucide-react";
import type { ChartSpec } from "@/contracts";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CHART_INFO } from "@/lib/chartbuilder/catalog";
import { useChartBuilder } from "@/stores/chartBuilder";
import { useProjectStore } from "@/stores/project";

const fmt = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export function chartName(spec: ChartSpec): string {
  const t = spec.customization.title;
  return typeof t === "string" && t.trim() ? t : CHART_INFO[spec.chart_type]?.label ?? "Chart";
}

/** The project's saved charts (the Charts tab). */
export function ChartsList() {
  const specs = useProjectStore((s) => s.project?.chart_specs ?? []);
  const startNew = useChartBuilder((s) => s.startNew);
  const open = useChartBuilder((s) => s.open);
  const remove = useChartBuilder((s) => s.remove);
  const duplicate = useChartBuilder((s) => s.duplicate);
  const sorted = [...specs].sort((a, b) => b.modified_at.localeCompare(a.modified_at));
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4" data-testid="charts-list-screen">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold">Charts</h2>
        <Button className="ml-auto" onClick={() => startNew()} data-testid="new-chart">
          <Plus aria-hidden /> New chart
        </Button>
      </div>
      {sorted.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No charts yet"
          body="Build a bar chart, box plot, Likert chart and more from your data. Statly suggests a chart when you tell it what you want to show."
        />
      ) : (
        <ul className="grid gap-2" data-testid="charts-list">
          {sorted.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-lg border p-3" data-testid={`chart-item-${s.id}`}>
              <button type="button" onClick={() => open(s.id)} className="grid min-w-0 flex-1 gap-0.5 rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" data-testid={`open-chart-${s.id}`}>
                <span className="truncate font-medium">{chartName(s)}</span>
                <span className="text-xs text-muted-foreground">
                  {CHART_INFO[s.chart_type]?.label}
                  {s.theme_preset === "apa" ? " · APA figure" : ""} · edited {fmt(s.modified_at)}
                </span>
              </button>
              <Button variant="ghost" size="icon-sm" onClick={() => duplicate(s.id)} aria-label={`Duplicate ${chartName(s)}`}>
                <Copy aria-hidden />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => remove(s.id)} aria-label={`Delete ${chartName(s)}`} data-testid={`delete-chart-${s.id}`}>
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
