/**
 * OS file dialogs (tauri-plugin-dialog). Paths picked here are also added to the fs scope by
 * the plugin, which is the only fs scope the app grants. In mock mode an in-app picker
 * (mocks/MockDialogHost) stands in, since a browser can't hand out real paths.
 */

export const DATA_FILE_EXTENSIONS = ["csv", "tsv", "txt", "xlsx"];
export const PROJECT_EXTENSION = "statly";

async function mockRequest<T>(kind: "import" | "open" | "save", defaultName?: string): Promise<T | null> {
  const { useMockDialog } = await import("@/mocks/dialogStore");
  return useMockDialog.getState().request<T>(kind, defaultName);
}

/** Pick one or more data files. Resolves null if the user cancels. */
export async function pickImportFiles(): Promise<string[] | null> {
  if (import.meta.env.VITE_STATLY_MOCK === "1") return mockRequest<string[]>("import");
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({
    multiple: true,
    directory: false,
    title: "Choose data files to import",
    filters: [{ name: "Data files (CSV, Excel)", extensions: DATA_FILE_EXTENSIONS }],
  });
  if (!res) return null;
  return Array.isArray(res) ? res : [res];
}

export async function pickProjectToOpen(): Promise<string | null> {
  if (import.meta.env.VITE_STATLY_MOCK === "1") return mockRequest<string>("open");
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({
    multiple: false,
    directory: false,
    title: "Open a Statly project",
    filters: [{ name: "Statly project", extensions: [PROJECT_EXTENSION] }],
  });
  return typeof res === "string" ? res : null;
}

export async function pickSavePath(defaultName: string): Promise<string | null> {
  if (import.meta.env.VITE_STATLY_MOCK === "1") return mockRequest<string>("save", defaultName);
  const { save } = await import("@tauri-apps/plugin-dialog");
  const res = await save({
    title: "Save project",
    defaultPath: `${defaultName}.${PROJECT_EXTENSION}`,
    filters: [{ name: "Statly project", extensions: [PROJECT_EXTENSION] }],
  });
  if (!res) return null;
  return res.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`) ? res : `${res}.${PROJECT_EXTENSION}`;
}

/** Directory for crash-recovery autosaves (Tauri app data dir + /autosave). */
export async function autosaveDir(): Promise<string> {
  if (import.meta.env.VITE_STATLY_MOCK === "1") return "/mock/autosave";
  const { appDataDir, join } = await import("@tauri-apps/api/path");
  return join(await appDataDir(), "autosave");
}
