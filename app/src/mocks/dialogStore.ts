import { create } from "zustand";

export type MockDialogKind = "import" | "open" | "save";

interface Pending {
  kind: MockDialogKind;
  defaultName?: string;
  resolve: (value: unknown) => void;
}

interface MockDialogState {
  pending: Pending | null;
  /** Paths "saved" this session, offered by the mock Open dialog. */
  savedPaths: string[];
  request: <T>(kind: MockDialogKind, defaultName?: string) => Promise<T | null>;
  finish: (value: unknown) => void;
}

export const useMockDialog = create<MockDialogState>((set, get) => ({
  pending: null,
  savedPaths: [],
  request: (kind, defaultName) =>
    new Promise((resolve) => {
      get().pending?.resolve(null);
      set({ pending: { kind, defaultName, resolve: resolve as (v: unknown) => void } });
    }),
  finish: (value) => {
    const p = get().pending;
    if (p?.kind === "save" && typeof value === "string" && !get().savedPaths.includes(value)) {
      set({ savedPaths: [...get().savedPaths, value] });
    }
    set({ pending: null });
    p?.resolve(value);
  },
}));
