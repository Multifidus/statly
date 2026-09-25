import { create } from "zustand";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "statly.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === "system") return systemPrefersDark ? "dark" : "light";
  return pref;
}

export function readStoredPreference(storage: Pick<Storage, "getItem"> | undefined): ThemePreference {
  try {
    const v = storage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(v) ? v : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(DARK_QUERY).matches
    : false;
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

/** Apply the resolved theme to <html>: `class="dark"` plus native `color-scheme`. */
export function applyTheme(theme: ResolvedTheme, root: HTMLElement = document.documentElement) {
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (pref: ThemePreference) => void;
  /** Re-evaluate `system` against the current OS setting. */
  syncWithSystem: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = readStoredPreference(safeStorage());
  return {
    preference: initial,
    resolved: resolveTheme(initial, systemPrefersDark()),
    setPreference: (pref) => {
      try {
        safeStorage()?.setItem(THEME_STORAGE_KEY, pref);
      } catch {
        /* storage unavailable: keep in-memory preference */
      }
      const resolved = resolveTheme(pref, systemPrefersDark());
      applyTheme(resolved);
      set({ preference: pref, resolved });
    },
    syncWithSystem: () => {
      const resolved = resolveTheme(get().preference, systemPrefersDark());
      applyTheme(resolved);
      set({ resolved });
    },
  };
});

/** Apply the stored theme before first render and follow OS changes while on `system`. */
export function initTheme() {
  const { syncWithSystem } = useThemeStore.getState();
  syncWithSystem();
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    window.matchMedia(DARK_QUERY).addEventListener("change", () => {
      useThemeStore.getState().syncWithSystem();
    });
  }
}
