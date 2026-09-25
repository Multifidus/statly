import { create } from "zustand";
import type { DatasetMeta, VariableSchema } from "@/contracts";
import { rpc } from "@/lib/rpc";

interface DatasetState {
  meta: DatasetMeta | null;
  /** Mirrors meta.snapshot_id; the grid keys its page cache on it. */
  snapshotId: string | null;
  /** Qualtrics metadata/timing columns are hidden by default (SPEC 5.2). */
  showMetadata: boolean;
  setMeta: (meta: DatasetMeta | null) => void;
  setShowMetadata: (show: boolean) => void;
  /** Re-fetch the per-variable missing summary from the engine. */
  refreshMissing: () => Promise<void>;
  clear: () => void;
}

export const useDatasetStore = create<DatasetState>((set, get) => ({
  meta: null,
  snapshotId: null,
  showMetadata: false,
  setMeta: (meta) => set({ meta, snapshotId: meta?.snapshot_id ?? null }),
  setShowMetadata: (showMetadata) => set({ showMetadata }),
  refreshMissing: async () => {
    const meta = get().meta;
    if (!meta) return;
    const res = await rpc.missingSummary({ dataset_id: meta.dataset_id });
    const cur = get().meta;
    if (!cur || cur.dataset_id !== meta.dataset_id) return;
    set({ meta: { ...cur, missing_summary: res.missing_summary } });
  },
  clear: () => set({ meta: null, snapshotId: null, showMetadata: false }),
}));

/** Variables in display order, optionally without Qualtrics metadata columns. */
export function visibleVariables(meta: DatasetMeta, showMetadata: boolean): VariableSchema[] {
  return [...meta.variables]
    .sort((a, b) => a.display_order - b.display_order)
    .filter((v) => showMetadata || !v.is_metadata);
}
