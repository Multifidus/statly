import { create } from "zustand";

/** localStorage key: mirrors stores/theme.ts's `statly.theme` pattern. */
export const ONBOARDING_STORAGE_KEY = "statly.onboarding";

function safeStorage(): Storage | undefined {
  try {
    return typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

function readSeen(): boolean {
  try {
    return safeStorage()?.getItem(ONBOARDING_STORAGE_KEY) === "done";
  } catch {
    return false;
  }
}

function writeSeen() {
  try {
    safeStorage()?.setItem(ONBOARDING_STORAGE_KEY, "done");
  } catch {
    /* storage unavailable: keep in-memory only */
  }
}

interface OnboardingState {
  /** Whether the tour dialog is currently open. */
  open: boolean;
  /** Current step index (0-based). */
  step: number;
  /** Start the tour from the first step. */
  start: () => void;
  /** Advance to the next step, or finish the tour on the last step. */
  next: (totalSteps: number) => void;
  /** Go back to the previous step (no-op on the first step). */
  back: () => void;
  /** Close the tour and persist that it's been seen. */
  dismiss: () => void;
}

export const useOnboarding = create<OnboardingState>((set, get) => ({
  open: !readSeen(),
  step: 0,
  start: () => set({ open: true, step: 0 }),
  next: (totalSteps) => {
    const step = get().step + 1;
    if (step >= totalSteps) {
      get().dismiss();
      return;
    }
    set({ step });
  },
  back: () => set({ step: Math.max(0, get().step - 1) }),
  dismiss: () => {
    writeSeen();
    set({ open: false, step: 0 });
  },
}));
