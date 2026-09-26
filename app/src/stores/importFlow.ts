import { create } from "zustand";
import type {
  DatasetImportPreviewResult,
  DatasetMeta,
  FilePreview,
  ImportFileInput,
  LinkReport,
  QualtricsMode,
} from "@/contracts";
import { buildImportParams, companionView, defaultDecisions, type ImportDecisions } from "@/lib/importLogic";
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

/**
 * Steps 4 and 5 only apply when several files are stacked as time points. Pass the preview's file
 * count once there is one: a numbers + words companion pair counts as one file.
 */
export function stepsFor(fileCount: number): StepId[] {
  return fileCount >= 2
    ? ["files", "detect", "cleanup", "stack", "link", "summary"]
    : ["files", "detect", "cleanup", "summary"];
}

interface ImportFlowState {
  step: StepId;
  files: ImportFileInput[];
  qualtricsMode: QualtricsMode;
  /** The preview the wizard works with; a companion pair is narrowed to its numbers file (companionView). */
  preview: DatasetImportPreviewResult | null;
  /** The words file of a companion pair: only used for value labels, contributes no rows. */
  labelsFile: FilePreview | null;
  decisions: ImportDecisions | null;
  busy: boolean;
  error: string | null;
  /** Set after a successful import. */
  result: { meta: DatasetMeta; linkReport: LinkReport | null } | null;
  /** Pending "replace this project's data?" prompt (ProjectMenu's "Import data…"), answered via answerGuard. */
  guard: { resolve: (ok: boolean) => void } | null;

  reset: () => void;
  /** Ask the user to confirm before an import that would replace an already-loaded dataset. */
  confirmReplace: () => Promise<boolean>;
  answerGuard: (ok: boolean) => void;
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
  labelsFile: null as FilePreview | null,
  decisions: null,
  busy: false,
  error: null,
  result: null,
};

export const useImportFlow = create<ImportFlowState>((set, get) => ({
  ...initial,
  guard: null,

  reset: () => set({ ...initial }),

  confirmReplace: () =>
    new Promise<boolean>((resolve) => {
      get().guard?.resolve(false);
      set({ guard: { resolve } });
    }),

  answerGuard: (ok) => {
    const g = get().guard;
    set({ guard: null });
    g?.resolve(ok);
  },

  addFiles: (paths) => {
    const have = new Set(get().files.map((f) => f.path));
    const add = paths.filter((p) => !have.has(p)).map((path) => ({ path, sheet_name: null }));
    set({ files: [...get().files, ...add], preview: null, labelsFile: null, decisions: null, error: null });
  },

  removeFile: (path) =>
    set({ files: get().files.filter((f) => f.path !== path), preview: null, labelsFile: null, decisions: null }),

  setQualtricsMode: (qualtricsMode) => set({ qualtricsMode, preview: null, labelsFile: null, decisions: null }),

  goTo: (step) => set({ step, error: null }),

  runPreview: async () => {
    const { files, qualtricsMode } = get();
    if (!files.length) return false;
    set({ busy: true, error: null });
    try {
      const raw = await rpc.importPreview({
        files: files as [ImportFileInput, ...ImportFileInput[]],
        qualtrics_mode: qualtricsMode,
        stack_onto_dataset_id: null,
      });
      const { preview, labelsFile } = companionView(raw);
      set({ preview, labelsFile, decisions: defaultDecisions(preview), busy: false });
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
