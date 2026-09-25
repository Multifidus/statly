import { beforeEach, describe, expect, it, vi } from "vitest";

function mockMatchMedia(dark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: dark && query.includes("dark"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

async function freshStore() {
  vi.resetModules();
  return import("./theme");
}

describe("theme store", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    mockMatchMedia(false);
  });

  it("resolves system preference against the OS setting", async () => {
    const { resolveTheme } = await freshStore();
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("defaults to system and ignores junk in storage", async () => {
    localStorage.setItem("statly.theme", "purple");
    mockMatchMedia(true);
    const { useThemeStore } = await freshStore();
    expect(useThemeStore.getState().preference).toBe("system");
    expect(useThemeStore.getState().resolved).toBe("dark");
  });

  it("persists the preference and toggles the dark class on <html>", async () => {
    const { useThemeStore, THEME_STORAGE_KEY } = await freshStore();
    useThemeStore.getState().setPreference("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    useThemeStore.getState().setPreference("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(useThemeStore.getState().resolved).toBe("light");
  });

  it("restores a stored preference on load", async () => {
    localStorage.setItem("statly.theme", "dark");
    const { useThemeStore } = await freshStore();
    expect(useThemeStore.getState().preference).toBe("dark");
    expect(useThemeStore.getState().resolved).toBe("dark");
  });
});
