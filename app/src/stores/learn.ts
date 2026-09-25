import { create } from "zustand";
import { useNav } from "@/stores/nav";

interface LearnState {
  /** Learn page shown (null = library index). */
  pageId: string | null;
  setPage: (id: string | null) => void;
}

export const useLearn = create<LearnState>((set) => ({
  pageId: null,
  setPage: (pageId) => set({ pageId }),
}));

/** Open the Learn library (optionally at a page); "Back" returns to the current screen. */
export function openLearn(pageId: string | null = null) {
  useLearn.getState().setPage(pageId);
  if (useNav.getState().view !== "learn") useNav.getState().go("learn");
}
