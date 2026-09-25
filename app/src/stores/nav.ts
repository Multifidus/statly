import { create } from "zustand";

/** Top-level screens. A tiny state router. */
export type View = "home" | "import" | "data" | "interview" | "variables";

interface NavState {
  view: View;
  go: (view: View) => void;
}

export const useNav = create<NavState>((set) => ({
  view: "home",
  go: (view) => set({ view }),
}));
