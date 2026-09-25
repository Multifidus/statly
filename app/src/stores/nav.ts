import { create } from "zustand";

/** Top-level screens. A tiny state router: Phase 1 has only three screens. */
export type View = "home" | "import" | "data";

interface NavState {
  view: View;
  go: (view: View) => void;
}

export const useNav = create<NavState>((set) => ({
  view: "home",
  go: (view) => set({ view }),
}));
