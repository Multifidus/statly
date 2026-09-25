import { create } from "zustand";

export interface Note {
  id: number;
  tone: "info" | "error";
  text: string;
}

interface NotifyState {
  note: Note | null;
  show: (text: string, tone?: Note["tone"]) => void;
  dismiss: () => void;
}

let seq = 0;
export const useNotify = create<NotifyState>((set) => ({
  note: null,
  show: (text, tone = "info") => set({ note: { id: ++seq, tone, text } }),
  dismiss: () => set({ note: null }),
}));
