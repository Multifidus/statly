/**
 * Full AnalysisResults for Test Log entries, held in memory for this session (the Test Log in
 * project.json keeps the summary), plus which entry the Results screen shows. Older entries
 * are reopened by re-running their stored request when the data is unchanged (pure engine).
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
  put: (id: string, result: AnalysisResult) => void;
  show: (id: string) => void;
  /** Make the full result for an entry available (cache, else re-run if the data is unchanged). */
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
  put: (id, result) => set({ byId: { ...get().byId, [id]: result } }),
  show: (id) => set({ currentId: id, error: null }),
  reopen: async (id) => {
    const cached = get().byId[id];
    if (cached) return cached;
    const entry = findEntry(id);
    const meta = useDatasetStore.getState().meta;
    if (!entry || !meta || entry.request.snapshot_id !== meta.snapshot_id || entry.request.dataset_id !== meta.dataset_id) return null;
    set({ loading: true, error: null });
    try {
      const result = await rpc.analysisRun(entry.request);
      set({ byId: { ...get().byId, [id]: result }, loading: false });
      return result;
    } catch (e) {
      set({ loading: false, error: describeRpcError(e) });
      return null;
    }
  },
  clear: () => set({ byId: {}, currentId: null, loading: false, error: null }),
}));
