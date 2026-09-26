import { create } from "zustand";
import { useImportFlow } from "@/stores/importFlow";

/** Top-level screens. A tiny state router. */
export type View =
  | "home"
  | "import"
  | "data"
  | "interview"
  | "variables"
  | "advisor"
  | "analysis"
  | "results"
  | "analyses"
  | "charts"
  | "qualitative"
  | "learn"
  | "planner";

interface NavState {
  view: View;
  /** Screen shown before the current one (Learn's "Back"). */
  prev: View | null;
  go: (view: View) => void;
  back: () => void;
}

export const useNav = create<NavState>((set, get) => ({
  view: "home",
  prev: null,
  go: (view) => {
    // Entering the import wizard always starts clean, no matter which menu/route sent us here
    // (previously only DataScreen's "Import a file" button reset the flow, so a stale preview
    // or file list from a prior visit could resurface through any other entry point).
    if (view === "import") useImportFlow.getState().reset();
    set({ view, prev: get().view === view ? get().prev : get().view });
  },
  back: () => set({ view: get().prev ?? "home", prev: null }),
}));
