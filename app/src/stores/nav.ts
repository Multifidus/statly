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
  /**
   * Optional hook a screen with unsaved work installs to block navigating away from it: resolves
   * true to allow the navigation, false to cancel it. Only one is active at a time (the current
   * screen's own). See ChartBuilder for the model (guardLeaveChartBuilder in stores/chartBuilder.ts).
   */
  leaveGuard: (() => Promise<boolean>) | null;
  setLeaveGuard: (guard: (() => Promise<boolean>) | null) => void;
  go: (view: View) => void;
  back: () => void;
}

export const useNav = create<NavState>((set, get) => {
  const commit = (view: View) => {
    // Entering the import wizard always starts clean, no matter which menu/route sent us here
    // (previously only DataScreen's "Import a file" button reset the flow, so a stale preview
    // or file list from a prior visit could resurface through any other entry point).
    if (view === "import") useImportFlow.getState().reset();
    set({ view, prev: get().view === view ? get().prev : get().view });
  };
  return {
    view: "home",
    prev: null,
    leaveGuard: null,
    setLeaveGuard: (guard) => set({ leaveGuard: guard }),
    go: (view) => {
      if (view === get().view) return;
      const guard = get().leaveGuard;
      if (guard) {
        void guard().then((ok) => {
          if (ok) commit(view);
        });
        return;
      }
      commit(view);
    },
    back: () => set({ view: get().prev ?? "home", prev: null }),
  };
});
