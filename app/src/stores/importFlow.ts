import { create } from "zustand";
import type {
  DatasetImportPreviewResult,
  DatasetMeta,
  ImportFileInput,
  LinkReport,
  QualtricsMode,
} from "@/contracts";
import { buildImportParams, defaultDecisions, type ImportDecisions } from "@/lib/importLogic";
import { describeRpcError, rpc } from "@/lib/rpc";
import { useDatasetStore } from "@/stores/dataset";
import { useProjectStore } from "@/stores/project";

export type StepId = "files" | "detect" | "cleanup" | "stack" | "link" | "summary";

export const STEP_TITLES: Record<StepId, string> = {
  files: "Choose files",
  detect: "Check how we read them",
  cleanup: "Survey clean-up",
  stack: "Combine time points",
  link: "Link people across time",
  summary: "Review and import",
};

/** Steps 4 and 5 only apply when several files are combined. */
export function stepsFor(fileCount: number): StepId[] {
  return fileCount >= 2
    ? ["files", "detect", "cleanup", "stack", "link", "summary"]
    : ["files", "detect", "cleanup", "summary"];
}

interface ImportFlowState {
  step: StepId;
  files: ImportFileInput[];
  qualtricsMode: QualtricsMode;
  preview: DatasetImportPreviewResult | null;
  decisions: ImportDecisions | null;
  busy: boolean;
  error: string | null;
  /** Set after a successful import. */
  result: { meta: DatasetMeta; linkReport: LinkReport | null } | null;

  reset: () => void;
  addFiles: (paths: string[]) => void;
  removeFile: (path: string) => void;
  setQualtricsMode: (m: QualtricsMode) => void;
  goTo: (step: StepId) => void;
  runPreview: () => Promise<boolean>;
  changeSheet: (fileId: string, sheet: string) => Promise<void>;
  update: (patch: Partial<ImportDecisions>) => void;
  commit: () => Promise<boolean>;
}

const initial = {
  step: "files" as StepId,
  files: [] as ImportFileInput[],
  qualtricsMode: "auto" as QualtricsMode,
  preview: null,
  decisions: null,
  busy: false,
  error: null,
  result: null,
};

export const useImportFlow = create<ImportFlowState>((set, get) => ({
  ...initial,

  reset: () => set({ ...initial }),

  addFiles: (paths) => {
    const have = new Set(get().files.map((f) => f.path));
    const add = paths.filter((p) => !have.has(p)).map((path) => ({ path, sheet_name: null }));
    set({ files: [...get().files, ...add], preview: null, decisions: null, error: null });
  },

  removeFile: (path) => set({ files: get().files.filter((f) => f.path !== path), preview: null, decisions: null }),

  setQualtricsMode: (qualtricsMode) => set({ qualtricsMode, preview: null, decisions: null }),

  goTo: (step) => set({ step, error: null }),

  runPreview: async () => {
    const { files, qualtricsMode } = get();
    if (!files.length) return false;
    set({ busy: true, error: null });
    try {
      const preview = await rpc.importPreview({
        files: files as [ImportFileInput, ...ImportFileInput[]],
        qualtrics_mode: qualtricsMode,
        stack_onto_dataset_id: null,
      });
      set({ preview, decisions: defaultDecisions(preview), busy: false });
      return true;
    } catch (e) {
      set({ busy: false, error: describeRpcError(e) });
      return false;
    }
  },

  changeSheet: async (fileId, sheet) => {
    const { preview, files, decisions: before } = get();
    const fp = preview?.files.find((f) => f.file_id === fileId);
    if (!fp) return;
    set({ files: files.map((f) => (f.path === fp.path ? { ...f, sheet_name: sheet } : f)) });
    if (!(await get().runPreview()) || !before) return;
    // file_id is derived from the path, so it survives the re-preview: keep what the user
    // already decided for the other files and for the stack as a whole.
    const fresh = get().decisions;
    if (!fresh) return;
    const others = (rec: Record<string, unknown>) => Object.fromEntries(Object.entries(rec).filter(([id]) => id !== fileId && id in fresh.timeLabels));
    const sameFiles = before.levelOrder.length === fresh.levelOrder.length && before.levelOrder.every((id) => fresh.levelOrder.includes(id));
    set({
      decisions: {
        ...fresh,
        qualtricsConfirmed: { ...fresh.qualtricsConfirmed, ...(others(before.qualtricsConfirmed) as Record<string, boolean>) },
        timeLabels: { ...fresh.timeLabels, ...(others(before.timeLabels) as Record<string, string>) },
        levelOrder: sameFiles ? before.levelOrder : fresh.levelOrder,
        timeVariable: before.timeVariable,
        linkMode: before.linkMode,
        normalization: before.normalization,
      },
    });
  },

  update: (patch) => {
    const d = get().decisions;
    if (d) set({ decisions: { ...d, ...patch } });
  },

  commit: async () => {
    const { preview, decisions } = get();
    if (!preview || !decisions) return false;
    set({ busy: true, error: null });
    try {
      const res = await rpc.importDataset(buildImportParams(preview, decisions));
      let meta = res.dataset_meta;
      let linkReport: LinkReport | null = null;
      if (preview.files.length > 1 && decisions.linkMode === "linked" && decisions.idVariable) {
        const linked = await rpc.link({
          dataset_id: meta.dataset_id,
          mode: "linked",
          id_variable: decisions.idVariable,
          normalization: decisions.normalization,
        });
        meta = linked.dataset_meta;
        linkReport = linked.report;
      }
      // Create the project first: newProject() clears the dataset store.
      if (!useProjectStore.getState().project) useProjectStore.getState().newProject();
      const ds = useDatasetStore.getState();
      ds.setMeta(meta);
      ds.setShowMetadata(!decisions.hideMetadata);
      useProjectStore.getState().markDirty();
      set({ busy: false, result: { meta, linkReport } });
      return true;
    } catch (e) {
      set({ busy: false, error: describeRpcError(e) });
      return false;
    }
  },
}));
