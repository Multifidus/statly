/**
 * Chart builder state (SPEC §10.2). The draft ChartSpec lives here; the engine computes its data
 * (`charts.data`), so the WebView only ever holds aggregated chart rows. Saved specs live in the
 * project (`project.chart_specs`) and round-trip through save/reopen.
 */
import { create } from "zustand";
import type { ChartSpec, ChartType, ShelfAggregate } from "@/contracts";
import { CHART_INFO, missingPiece, suggestShelves, type Goal } from "@/lib/chartbuilder/catalog";
import { addToShelf, cleanSpec, dataKey, newChartId, newChartSpec, removeFromShelf, setAggregate, withChartType, withPreset } from "@/lib/chartbuilder/spec";
import type { BuilderCustomization, ChartsDataResult, ShelfName } from "@/lib/chartbuilder/types";
import { chartsRpc, describeRpcError } from "@/lib/rpc";
import { useDatasetStore } from "@/stores/dataset";
import { useProjectStore } from "@/stores/project";

export type PreviewTheme = "app" | "light" | "dark";

interface ChartBuilderState {
  /** Spec being edited; null = the Charts list is showing. */
  draft: ChartSpec | null;
  /** Whether the draft already exists in project.chart_specs. */
  isSaved: boolean;
  /** Draft differs from what is saved in the project. */
  unsaved: boolean;
  goal: Goal | null;
  data: ChartsDataResult | null;
  /** dataKey(spec) + snapshot of the data currently held. */
  dataFor: string | null;
  loading: boolean;
  error: string | null;
  previewTheme: PreviewTheme;

  startNew: (type?: ChartType) => void;
  open: (id: string) => void;
  close: () => void;
  setGoal: (goal: Goal | null) => void;
  /** Choose a chart type; `suggest` fills empty shelves from the variables' roles. */
  setType: (type: ChartType, suggest?: boolean) => void;
  addField: (shelf: ShelfName, variable: string, index?: number) => void;
  removeField: (shelf: ShelfName, variable: string) => void;
  setFieldAggregate: (shelf: ShelfName, variable: string, aggregate: ShelfAggregate) => void;
  clearShelves: () => void;
  setErrorBars: (kind: ChartSpec["error_bars"]) => void;
  setSource: (testLogEntryId: string | null) => void;
  customize: (patch: Partial<BuilderCustomization>) => void;
  setAxis: (axis: "x_axis" | "y_axis", patch: { label?: string | null; min?: number | null; max?: number | null }) => void;
  setPreset: (preset: ChartSpec["theme_preset"]) => void;
  setPreviewTheme: (t: PreviewTheme) => void;
  /** Fetch chart data from the engine when the data-relevant part of the spec changed. */
  refresh: (force?: boolean) => Promise<void>;
  save: () => ChartSpec | null;
  remove: (id: string) => void;
  duplicate: (id: string) => ChartSpec | null;
}

let seq = 0;

function savedSpecs(): ChartSpec[] {
  return useProjectStore.getState().project?.chart_specs ?? [];
}

export const useChartBuilder = create<ChartBuilderState>((set, get) => {
  const edit = (fn: (s: ChartSpec) => ChartSpec) => {
    const d = get().draft;
    if (!d) return;
    set({ draft: fn(d), unsaved: true });
  };
  return {
    draft: null,
    isSaved: false,
    unsaved: false,
    goal: null,
    data: null,
    dataFor: null,
    loading: false,
    error: null,
    previewTheme: "app",

    startNew: (type = "bar") => {
      const spec = newChartSpec(type);
      set({ draft: spec, isSaved: false, unsaved: true, goal: null, data: null, dataFor: null, error: null, loading: false });
    },

    open: (id) => {
      const spec = savedSpecs().find((s) => s.id === id);
      if (!spec) return;
      set({ draft: structuredClone(spec), isSaved: true, unsaved: false, goal: null, data: null, dataFor: null, error: null, loading: false });
    },

    close: () => set({ draft: null, data: null, dataFor: null, error: null, loading: false, unsaved: false, goal: null }),

    setGoal: (goal) => set({ goal }),

    setType: (type, suggest = false) =>
      edit((s) => {
        const next = withChartType(s, type);
        const empty = !next.shelves.x.length && !next.shelves.y.length && !next.shelves.color.length && !next.shelves.facet.length;
        const meta = useDatasetStore.getState().meta;
        if (suggest && meta && CHART_INFO[type].source === "dataset" && (empty || missingPiece(next))) {
          return { ...next, shelves: suggestShelves(type, meta.variables) };
        }
        return next;
      }),

    addField: (shelf, variable, index) => edit((s) => addToShelf(s, shelf, variable, index)),
    removeField: (shelf, variable) => edit((s) => removeFromShelf(s, shelf, variable)),
    setFieldAggregate: (shelf, variable, aggregate) => edit((s) => setAggregate(s, shelf, variable, aggregate)),
    clearShelves: () => edit((s) => ({ ...s, shelves: { x: [], y: [], color: [], facet: [] } })),
    setErrorBars: (kind) => edit((s) => ({ ...s, error_bars: kind })),
    setSource: (id) => edit((s) => ({ ...s, source: { kind: "analysis", test_log_entry_id: id } })),
    customize: (patch) => edit((s) => ({ ...s, customization: { ...s.customization, ...patch } })),
    setAxis: (axis, patch) => edit((s) => ({ ...s, customization: { ...s.customization, [axis]: { ...(s.customization[axis] ?? {}), ...patch } } })),
    setPreset: (preset) =>
      edit((s) => {
        const others = savedSpecs().filter((c) => c.id !== s.id && c.theme_preset === "apa").length;
        return withPreset(s, preset, others + 1);
      }),
    setPreviewTheme: (previewTheme) => set({ previewTheme }),

    refresh: async (force = false) => {
      const spec = get().draft;
      if (!spec) return;
      const meta = useDatasetStore.getState().meta;
      const key = `${dataKey(spec)}@${meta?.snapshot_id ?? ""}`;
      if (!force && key === get().dataFor) return;
      const missing = missingPiece(spec);
      if (missing) {
        seq++;
        set({ data: null, dataFor: key, error: null, loading: false });
        return;
      }
      const mine = ++seq;
      set({ loading: true, error: null });
      try {
        const data = await chartsRpc.data({ dataset_id: meta?.dataset_id ?? null, snapshot_id: meta?.snapshot_id ?? null, spec: cleanSpec(spec) });
        if (mine !== seq) return;
        set({ data, dataFor: key, loading: false });
      } catch (e) {
        if (mine !== seq) return;
        // Chart-data errors from the engine are already plain language (which shelf is missing, etc.).
        const err = e as { kind?: string; code?: number; message?: string };
        const msg = err?.kind === "rpc" && (err.code === -32003 || err.code === -32002) && err.message ? err.message : describeRpcError(e);
        set({ data: null, dataFor: key, loading: false, error: msg });
      }
    },

    save: () => {
      const d = get().draft;
      if (!d || !useProjectStore.getState().project) return null;
      const spec = cleanSpec({ ...d, modified_at: new Date().toISOString() });
      useProjectStore.getState().updateProject((p) => {
        const list = p.chart_specs ?? [];
        const i = list.findIndex((c) => c.id === spec.id);
        return { ...p, chart_specs: i >= 0 ? list.map((c) => (c.id === spec.id ? spec : c)) : [...list, spec] };
      });
      set({ draft: spec, isSaved: true, unsaved: false });
      return spec;
    },

    remove: (id) => {
      useProjectStore.getState().updateProject((p) => ({ ...p, chart_specs: (p.chart_specs ?? []).filter((c) => c.id !== id) }));
      if (get().draft?.id === id) get().close();
    },

    duplicate: (id) => {
      const src = savedSpecs().find((s) => s.id === id);
      if (!src) return null;
      const now = new Date().toISOString();
      const title = (src.customization.title as string | null | undefined) ?? null;
      const copy: ChartSpec = { ...structuredClone(src), id: newChartId(), created_at: now, modified_at: now, customization: { ...src.customization, ...(title ? { title: `${title} (copy)` } : {}) } };
      useProjectStore.getState().updateProject((p) => ({ ...p, chart_specs: [...(p.chart_specs ?? []), copy] }));
      return copy;
    },
  };
});
