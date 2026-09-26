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

/** Pick an answer-key file (CSV/Excel: question, correct answer). Resolves null if cancelled. */
export async function pickAnswerKeyFile(): Promise<string | null> {
  if (import.meta.env.VITE_STATLY_MOCK === "1") return (await mockRequest<string[]>("import"))?.[0] ?? null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({
    multiple: false,
    directory: false,
    title: "Choose your answer key",
    filters: [{ name: "Answer key (CSV, Excel)", extensions: DATA_FILE_EXTENSIONS }],
  });
  return typeof res === "string" ? res : null;
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

/** Human-readable label + extension list for a save-dialog filter, keyed by export format. */
const EXPORT_FILTERS: Record<string, { name: string; extensions: string[] }> = {
  docx: { name: "Word document", extensions: ["docx"] },
  pdf: { name: "PDF document", extensions: ["pdf"] },
  xlsx: { name: "Excel workbook", extensions: ["xlsx"] },
  csv: { name: "CSV file", extensions: ["csv"] },
  png: { name: "PNG image", extensions: ["png"] },
  svg: { name: "SVG image", extensions: ["svg"] },
};

/** Pick where to save an export (report, data, codebook, test log, or chart figure). Appends the
 * format's extension if the user didn't type one. Resolves null if the user cancels. */
export async function pickExportPath(defaultName: string, format: keyof typeof EXPORT_FILTERS): Promise<string | null> {
  const filter = EXPORT_FILTERS[format];
  if (import.meta.env.VITE_STATLY_MOCK === "1") {
    const res = await mockRequest<string>("save", `${defaultName}.${format}`);
    if (!res) return null;
    return res.toLowerCase().endsWith(`.${format}`) ? res : `${res}.${format}`;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const res = await save({
    title: `Save as ${filter.name}`,
    defaultPath: `${defaultName}.${format}`,
    filters: [filter],
  });
  if (!res) return null;
  return res.toLowerCase().endsWith(`.${format}`) ? res : `${res}.${format}`;
}

/** Directory for crash-recovery autosaves (Tauri app data dir + /autosave). */
export async function autosaveDir(): Promise<string> {
  if (import.meta.env.VITE_STATLY_MOCK === "1") return "/mock/autosave";
  const { appDataDir, join } = await import("@tauri-apps/api/path");
  return join(await appDataDir(), "autosave");
}
