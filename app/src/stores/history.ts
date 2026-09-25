/**
 * Undo/redo for dataset edits (SPEC §6). The engine keeps an ordered snapshot history per
 * dataset (`dataset.history`); this store mirrors it and treats undo/redo as moving a pointer
 * through that list with `dataset.restore_snapshot`. Entries that are only labels (from before
 * the project was opened) can't be restored.
 */
import { create } from "zustand";
import { rpc } from "@/lib/rpc";
import type { HistoryEntry } from "@/lib/variablesRpc";
import { useDatasetStore } from "@/stores/dataset";

interface HistoryState {
  datasetId: string | null;
  entries: HistoryEntry[];
  /** Index of the current snapshot in `entries` (-1 = unknown / no data). */
  cursor: number;
  busy: boolean;
  /** Re-read the engine's history for the current dataset. */
  refresh: () => Promise<void>;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** Label of the change an undo would revert (for button tooltips). */
  undoLabel: () => string | null;
  redoLabel: () => string | null;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  reset: () => void;
}

let refreshSeq = 0;

export const useHistory = create<HistoryState>((set, get) => {
  const move = async (delta: -1 | 1): Promise<boolean> => {
    const { entries, cursor, datasetId, busy } = get();
    const target = entries[cursor + delta];
    if (busy || !datasetId || !target?.restorable) return false;
    set({ busy: true });
    try {
      const res = await rpc.restoreSnapshot({ dataset_id: datasetId, snapshot_id: target.snapshot_id });
      set({ cursor: cursor + delta });
      useDatasetStore.getState().setMeta(res.dataset_meta);
      return true;
    } finally {
      set({ busy: false });
    }
  };

  return {
    datasetId: null,
    entries: [],
    cursor: -1,
    busy: false,

    refresh: async () => {
      const meta = useDatasetStore.getState().meta;
      if (!meta) {
        get().reset();
        return;
      }
      const seq = ++refreshSeq;
      try {
        const res = await rpc.history({ dataset_id: meta.dataset_id });
        if (seq !== refreshSeq) return;
        set({ datasetId: res.dataset_id, entries: res.entries, cursor: res.cursor });
      } catch {
        if (seq === refreshSeq) set({ datasetId: meta.dataset_id, entries: [], cursor: -1 });
      }
    },

    canUndo: () => {
      const { entries, cursor, busy } = get();
      return !busy && cursor > 0 && !!entries[cursor - 1]?.restorable;
    },
    canRedo: () => {
      const { entries, cursor, busy } = get();
      return !busy && cursor >= 0 && !!entries[cursor + 1]?.restorable;
    },
    undoLabel: () => {
      const { entries, cursor } = get();
      return cursor > 0 ? (entries[cursor]?.label ?? null) : null;
    },
    redoLabel: () => {
      const { entries, cursor } = get();
      return entries[cursor + 1]?.label ?? null;
    },
    undo: () => move(-1),
    redo: () => move(1),
    reset: () => {
      refreshSeq++;
      set({ datasetId: null, entries: [], cursor: -1, busy: false });
    },
  };
});

// Keep the history in step with whatever dataset snapshot is current (import, open, link, edits,
// undo/redo). Skipped when the new snapshot is already the one the pointer is on.
useDatasetStore.subscribe((s, prev) => {
  if (s.snapshotId === prev.snapshotId && s.meta?.dataset_id === prev.meta?.dataset_id) return;
  const h = useHistory.getState();
  if (!s.meta) {
    h.reset();
    return;
  }
  if (h.datasetId === s.meta.dataset_id && h.entries[h.cursor]?.snapshot_id === s.snapshotId) return;
  void h.refresh();
});
