/**
 * Export > Report… dialog (SPEC §10.3): pick logged tests from the Test Log, toggle what's
 * included, render each selected result's chart to a PNG, and call `export.report`. Also carries
 * the multiple-comparison choice: every selected entry's TestLogEntry (family_id, correction_method,
 * adjusted_p) and the project's test_families go to the engine so a Holm/Bonferroni/BH family
 * member's APA sentence gets its adjusted-p note (SPEC §9).
 */
import { create } from "zustand";
import type { AnalysisResult } from "@/contracts";
import { pickReportChart } from "@/lib/export/chartSelection";
import { chartPngDataUrl } from "@/lib/export/figure";
import { isFileExists } from "@/lib/export/writeRetry";
import { pickExportPath } from "@/lib/dialogs";
import { describeRpcError, rpc, type ExportInclude } from "@/lib/rpc";
import { useProjectStore } from "@/stores/project";
import { useResults } from "@/stores/results";
import { useThemeStore } from "@/stores/theme";

export type ExportFormat = "docx" | "pdf";
export type ExportStatus = "idle" | "rendering" | "saving" | "done" | "error";

interface ExportFlowState {
  open: boolean;
  selectedIds: string[];
  include: Required<ExportInclude>;
  title: string;
  author: string;
  format: ExportFormat;
  status: ExportStatus;
  error: string | null;
  savedPath: string | null;
  /** Set when the engine refused to overwrite; the dialog offers "Replace?" and retries with it set. */
  confirmOverwritePath: string | null;

  show: () => void;
  hide: () => void;
  toggleSelected: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  setInclude: (key: keyof ExportInclude, value: boolean) => void;
  setTitle: (title: string) => void;
  setAuthor: (author: string) => void;
  setFormat: (format: ExportFormat) => void;
  run: () => Promise<void>;
  confirmReplace: () => Promise<void>;
  reset: () => void;
}

const defaults = {
  open: false,
  selectedIds: [] as string[],
  include: { tables: true, sentences: true, assumptions: true, charts: true } as Required<ExportInclude>,
  title: "",
  author: "",
  format: "docx" as ExportFormat,
  status: "idle" as ExportStatus,
  error: null as string | null,
  savedPath: null as string | null,
  confirmOverwritePath: null as string | null,
};

/** Renders one PNG per selected result (SPEC §10.3: "each selected analysis's ... charts"), skipping
 * any chart that fails to render rather than failing the whole report. */
async function renderCharts(results: AnalysisResult[]) {
  const theme = useThemeStore.getState().resolved;
  const charts: { request_id: string; png_base64: string; title?: string | null }[] = [];
  for (const r of results) {
    const ref = pickReportChart(r);
    if (!ref) continue;
    const rows = r.chart_data[ref.data_key] ?? [];
    try {
      const dataUrl = await chartPngDataUrl(ref.chart_type, rows, theme, ref.title, 2);
      charts.push({ request_id: r.inputs.request.request_id, png_base64: dataUrl.split(",", 2)[1] ?? "", title: ref.title });
    } catch {
      // Skip: the report still exports without this one figure.
    }
  }
  return charts;
}

async function save(path: string, overwrite: boolean) {
  const s = useExportFlow.getState();
  const project = useProjectStore.getState().project;
  if (!project) throw new Error("no project");
  const entries = project.test_log.filter((e) => s.selectedIds.includes(e.id));
  const results: AnalysisResult[] = [];
  for (const e of entries) {
    const r = await useResults.getState().reopen(e.id);
    if (r) results.push(r);
  }
  if (results.length === 0) {
    useExportFlow.setState({ status: "error", error: "Statly couldn't load those results. Try reopening them from the Test Log first." });
    return;
  }
  useExportFlow.setState({ status: "rendering" });
  const charts = s.include.charts ? await renderCharts(results) : [];
  useExportFlow.setState({ status: "saving" });
  try {
    const out = await rpc.exportReport({
      title: s.title.trim() || "Report", author: s.author.trim() || null, results,
      include: s.include, charts, test_log: entries, test_families: project.test_families,
      format: s.format, path, overwrite,
    });
    useExportFlow.setState({ status: "done", savedPath: out.path, confirmOverwritePath: null });
  } catch (e) {
    if (!overwrite && isFileExists(e)) {
      useExportFlow.setState({ status: "idle", confirmOverwritePath: path, error: null });
      return;
    }
    useExportFlow.setState({ status: "error", error: describeRpcError(e), confirmOverwritePath: null });
  }
}

export const useExportFlow = create<ExportFlowState>((set, get) => ({
  ...defaults,

  show: () => set({ ...defaults, open: true, title: useProjectStore.getState().project?.name ?? "Report" }),
  hide: () => set({ open: false }),
  toggleSelected: (id) =>
    set((s) => ({ selectedIds: s.selectedIds.includes(id) ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id] })),
  selectAll: (ids) => set({ selectedIds: ids }),
  clearSelection: () => set({ selectedIds: [] }),
  setInclude: (key, value) => set((s) => ({ include: { ...s.include, [key]: value } })),
  setTitle: (title) => set({ title }),
  setAuthor: (author) => set({ author }),
  setFormat: (format) => set({ format }),

  run: async () => {
    const s = get();
    if (s.selectedIds.length === 0) {
      set({ error: "Choose at least one test to include." });
      return;
    }
    const path = await pickExportPath(s.title.trim() || "Report", s.format);
    if (!path) return;
    set({ error: null });
    await save(path, false);
  },

  confirmReplace: async () => {
    const path = get().confirmOverwritePath;
    if (!path) return;
    await save(path, true);
  },

  reset: () => set(defaults),
}));
