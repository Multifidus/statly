import { create } from "zustand";

export interface Note {
  id: number;
  tone: "info" | "error";
  text: string;
  /** Raw technical detail (error code, message) shown under a collapsed disclosure, so it's
   * never lost even when `text` is a plain-language summary. */
  details?: string;
}

interface NotifyState {
  note: Note | null;
  show: (text: string, tone?: Note["tone"], details?: string) => void;
  dismiss: () => void;
}

let seq = 0;
export const useNotify = create<NotifyState>((set) => ({
  note: null,
  show: (text, tone = "info", details) => set({ note: { id: ++seq, tone, text, details } }),
  dismiss: () => set({ note: null }),
}));
