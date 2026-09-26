/**
 * Full AnalysisResults for Test Log entries, cached for this session and handed to the engine
 * (`results.put`) so project save writes them to results/<id>.json (SPEC §9), plus which entry the
 * Results screen shows. Older entries reopen from the saved copy (`results.get`), else by
 * re-running their stored request when the data is unchanged (pure engine).
 */
import { create } from "zustand";
import type { AnalysisResult, TestLogEntry } from "@/contracts";
import { describeRpcError, rpc } from "@/lib/rpc";
import { useDatasetStore } from "@/stores/dataset";
import { useProjectStore } from "@/stores/project";

interface ResultsState {
  byId: Record<string, AnalysisResult>;
  /** Entry shown on the Results screen. */
  currentId: string | null;
  loading: boolean;
  error: string | null;
  /** Cache a result; `persist` also hands it to the engine so project save writes results/<id>.json. */
  put: (id: string, result: AnalysisResult, opts?: { persist?: boolean }) => void;
  show: (id: string) => void;
  /** Make the full result for an entry available: cache, else the copy saved in the project
   * (`results.get`, never re-runs), else re-run if the data is unchanged. */
  reopen: (id: string) => Promise<AnalysisResult | null>;
  clear: () => void;
}

export function findEntry(id: string | null): TestLogEntry | null {
  if (!id) return null;
  return useProjectStore.getState().project?.test_log.find((e) => e.id === id) ?? null;
}

export const useResults = create<ResultsState>((set, get) => ({
  byId: {},
  currentId: null,
  loading: false,
  error: null,
  put: (id, result, opts) => {
    set({ byId: { ...get().byId, [id]: result } });
    // Best effort: if the engine can't take it, the entry saves without result_path and reopens
    // by re-running (unchanged data) or from its summary.
    if (opts?.persist) void rpc.resultsPut({ request_id: id, result }).catch(() => undefined);
  },
  show: (id) => set({ currentId: id, error: null }),
  reopen: async (id) => {
    const cached = get().byId[id];
    if (cached) return cached;
    const entry = findEntry(id);
    if (entry?.result_path) {
      try {
        const { result } = await rpc.resultsGet({ request_id: id });
        set({ byId: { ...get().byId, [id]: result } });
        return result;
      } catch {
        // Not in the engine (e.g. the file was saved by an older build): fall through.
      }
    }
    const meta = useDatasetStore.getState().meta;
    if (!entry || !meta || entry.request.snapshot_id !== meta.snapshot_id || entry.request.dataset_id !== meta.dataset_id) return null;
    set({ loading: true, error: null });
    try {
      const result = await rpc.analysisRun(entry.request);
      set({ loading: false });
      get().put(id, result, { persist: true });
      return result;
    } catch (e) {
      set({ loading: false, error: describeRpcError(e) });
      return null;
    }
  },
  clear: () => set({ byId: {}, currentId: null, loading: false, error: null }),
}));
