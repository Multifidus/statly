import { create } from "zustand";

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
  go: (view) => set({ view, prev: get().view === view ? get().prev : get().view }),
  back: () => set({ view: get().prev ?? "home", prev: null }),
}));
