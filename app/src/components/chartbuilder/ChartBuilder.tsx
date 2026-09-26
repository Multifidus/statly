import { useEffect, useRef } from "react";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { cn } from "cn";
import type { ChartSpec } from "@/contracts";
import { Button } from "@/components/ui/button";
import { Badge, NativeSelect, Notice } from "@/components/ui/form";
import { BuilderChart, type BuilderChartHandle } from "@/components/chartbuilder/BuilderChart";
import { chartName } from "@/components/chartbuilder/ChartsList";
import { CustomizePanel } from "@/components/chartbuilder/CustomizePanel";
import { GoalHelper } from "@/components/chartbuilder/GoalHelper";
import { NumbersTableView } from "@/components/chartbuilder/NumbersTableView";
import { ShelfBoard } from "@/components/chartbuilder/ShelfBoard";
import { SaveFigureButton } from "@/components/export/SaveFigureButton";
import { CHART_INFO, missingPiece } from "@/lib/chartbuilder/catalog";
import { autoTitle } from "@/lib/chartbuilder/compile";
import { dataKey } from "@/lib/chartbuilder/spec";
import { filenameFor } from "@/lib/export/saveFigure";
import { useChartBuilder, type PreviewTheme } from "@/stores/chartBuilder";
import { useDatasetStore, visibleVariables } from "@/stores/dataset";
import { useNotify } from "@/stores/notify";
import { useProjectStore } from "@/stores/project";
import { useThemeStore } from "@/stores/theme";

const FACTOR_IDS: Record<string, string> = { scree: "validity.efa", cfa_path: "validity.cfa" };

function AnalysisSource({ spec }: { spec: ChartSpec }) {
  const log = useProjectStore((s) => s.project?.test_log ?? []);
  const setSource = useChartBuilder((s) => s.setSource);
  const want = FACTOR_IDS[spec.chart_type];
  const entries = log.filter((e) => e.request.analysis_id === want);
  const kind = want === "validity.efa" ? "exploratory factor analysis (EFA)" : "confirmatory factor analysis (CFA)";
  if (!entries.length) {
    return <Notice data-testid="no-factor-results">This chart comes from a saved {kind}. Run one from Analyze first; it will then appear here.</Notice>;
  }
  return (
    <label className="grid gap-1 rounded-lg border p-3 text-sm">
      <span className="font-medium">Analysis to draw from</span>
      <NativeSelect value={spec.source.test_log_entry_id ?? ""} onChange={(e) => setSource(e.target.value || null)} data-testid="chart-source">
        <option value="">Choose a saved {kind}</option>
        {entries.map((e) => (
          <option key={e.id} value={e.id}>
            {(e.request.variables.items ?? []).length} items · {new Date(e.timestamp).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}

const PREVIEWS: { value: PreviewTheme; label: string }[] = [
  { value: "app", label: "Match app" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function Preview({ spec }: { spec: ChartSpec }) {
  const data = useChartBuilder((s) => s.data);
  const loading = useChartBuilder((s) => s.loading);
  const error = useChartBuilder((s) => s.error);
  const dataFor = useChartBuilder((s) => s.dataFor);
  const previewTheme = useChartBuilder((s) => s.previewTheme);
  const setPreviewTheme = useChartBuilder((s) => s.setPreviewTheme);
  const appTheme = useThemeStore((s) => s.resolved);
  const snapshot = useDatasetStore((s) => s.snapshotId);
  const theme = previewTheme === "app" ? appTheme : previewTheme;
  const chartRef = useRef<BuilderChartHandle>(null);
  const missing = missingPiece(spec);
  const current = dataFor === `${dataKey(spec)}@${snapshot ?? ""}`;
  const label = `${CHART_INFO[spec.chart_type].label}: ${(spec.customization.title as string | undefined) || autoTitle(spec, data)}`;
  const drawn = !missing && !error && !!data && current;
  return (
    <section aria-label="Preview" className="grid min-w-0 gap-2" data-testid="chart-preview">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Preview</h3>
        {loading && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
            <Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> Updating…
          </span>
        )}
        <div role="radiogroup" aria-label="Preview background" className="ml-auto flex gap-0.5 rounded-md border p-0.5">
          {PREVIEWS.map((p) => (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={previewTheme === p.value}
              onClick={() => setPreviewTheme(p.value)}
              data-testid={`preview-${p.value}`}
              className={cn("rounded-sm px-2 py-0.5 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", previewTheme === p.value ? "bg-accent font-semibold" : "text-muted-foreground hover:text-foreground")}
            >
              {p.label}
            </button>
          ))}
        </div>
        {drawn && <SaveFigureButton view={() => chartRef.current?.getVegaView() ?? null} title={label} defaultName={filenameFor(label)} />}
      </div>
      <div className={cn("min-h-40 overflow-auto rounded-lg border p-4", theme === "dark" ? "bg-[#1f1f1e] text-[#f0efec]" : "bg-white text-[#1a1a19]")} data-theme-preview={theme}>
        {missing ? (
          <p className="text-sm opacity-80" data-testid="chart-missing">
            {missing}
          </p>
        ) : error ? (
          <Notice tone="error" data-testid="chart-error">
            {error}
          </Notice>
        ) : data && current ? (
          <BuilderChart ref={chartRef} spec={spec} data={data} theme={theme} label={label} />
        ) : (
          <p className="text-sm opacity-80">Drawing…</p>
        )}
      </div>
      {!missing && !error && data && current && <NumbersTableView spec={spec} data={data} />}
    </section>
  );
}

/** The shelf-style chart builder for one chart (SPEC §10.2). */
export function ChartBuilder({ spec }: { spec: ChartSpec }) {
  const meta = useDatasetStore((s) => s.meta);
  const snapshot = useDatasetStore((s) => s.snapshotId);
  const isSaved = useChartBuilder((s) => s.isSaved);
  const unsaved = useChartBuilder((s) => s.unsaved);
  const refresh = useChartBuilder((s) => s.refresh);
  const data = useChartBuilder((s) => s.data);
  const save = useChartBuilder((s) => s.save);
  const close = useChartBuilder((s) => s.close);
  const key = dataKey(spec);

  useEffect(() => {
    const t = window.setTimeout(() => void refresh(), 120);
    return () => window.clearTimeout(t);
  }, [key, snapshot, refresh]);

  const vars = meta ? visibleVariables(meta, false).filter((v) => !["ignore", "open_text", "identifier"].includes(v.role)) : [];
  const fromAnalysis = CHART_INFO[spec.chart_type].source === "analysis";
  const onSave = () => {
    if (save()) useNotify.getState().show("Chart saved to the project.");
  };
  return (
    <div className="grid w-full gap-4" data-testid="chart-builder">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={close} data-testid="back-to-charts">
          <ArrowLeft aria-hidden /> Charts
        </Button>
        <h2 className="min-w-0 truncate text-xl font-semibold">{isSaved ? chartName(spec) : "New chart"}</h2>
        {unsaved ? <Badge tone="warn">Not saved</Badge> : <Badge tone="ok" data-testid="chart-saved">Saved in project</Badge>}
        <Button className="ml-auto" onClick={onSave} disabled={!unsaved} data-testid="chart-save">
          <Save aria-hidden /> Save chart
        </Button>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="grid min-w-0 content-start gap-4">
          <GoalHelper spec={spec} />
          {fromAnalysis ? (
            <>
              <AnalysisSource spec={spec} />
              <Preview spec={spec} />
            </>
          ) : (
            <ShelfBoard spec={spec} vars={vars}>
              <Preview spec={spec} />
            </ShelfBoard>
          )}
        </div>
        <CustomizePanel spec={spec} data={data} />
      </div>
    </div>
  );
}
