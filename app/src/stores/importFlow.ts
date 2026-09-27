import { create } from "zustand";
import type {
  DatasetImportPreviewResult,
  DatasetMeta,
  FilePreview,
  ImportFileInput,
  ImportIssue,
  LinkReport,
  QualtricsMode,
  Survey,
  SurveySuggestResult,
} from "@/contracts";
import {
  buildImportParams,
  companionView,
  defaultDecisions,
  surveyMatchSummary,
  surveyMatchVariables,
  surveyPatches,
  type ImportDecisions,
} from "@/lib/importLogic";
import { RpcErrorCode } from "@/lib/errors";
import { describeRpcError, rpc } from "@/lib/rpc";
import { edits } from "@/lib/variableEdits";
import { useInterview } from "@/stores/interview";
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
  /** Optional Qualtrics survey design file (.qsf), parsed; stored with the import. */
  survey: SurveyFile | null;
  /** Why the chosen survey file couldn't be used (shown by the picker). */
  surveyError: string | null;
  /** How the survey matches the columns being imported (Review step); null until checked. */
  surveyMatch: ReturnType<typeof surveyMatchSummary> | null;
  /** Set after a successful import. `survey`: suggestions from the survey file, when one was added. */
  result: { meta: DatasetMeta; linkReport: LinkReport | null; survey?: SurveySuggestResult | null; surveyWarning?: string | null } | null;
  /** Pending "replace this project's data?" prompt (ProjectMenu's "Import data…"), answered via answerGuard. */
  guard: { resolve: (ok: boolean) => void } | null;

  reset: () => void;
  /** Ask the user to confirm before an import that would replace an already-loaded dataset. */
  confirmReplace: () => Promise<boolean>;
  answerGuard: (ok: boolean) => void;
  addFiles: (paths: string[]) => void;
  removeFile: (path: string) => void;
  /** Parse and attach a survey file (replaces any earlier one). Resolves false if it couldn't be read. */
  addSurvey: (path: string) => Promise<boolean>;
  removeSurvey: () => void;
  /** Match the attached survey against the columns being imported (fills surveyMatch). */
  checkSurvey: () => Promise<void>;
  setQualtricsMode: (m: QualtricsMode) => void;
  goTo: (step: StepId) => void;
  runPreview: () => Promise<boolean>;
  changeSheet: (fileId: string, sheet: string) => Promise<void>;
  update: (patch: Partial<ImportDecisions>) => void;
  commit: () => Promise<boolean>;
}

export interface SurveyFile {
  path: string;
  /** File name without folders. */
  fileName: string;
  survey: Survey;
  /** Questions that produce data columns (not in the survey's Trash, with at least one column). */
  nQuestions: number;
  issues: ImportIssue[];
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

const initial = {
  step: "files" as StepId,
  files: [] as ImportFileInput[],
  qualtricsMode: "auto" as QualtricsMode,
  preview: null,
  labelsFile: null as FilePreview | null,
  decisions: null,
  busy: false,
  error: null,
  survey: null as SurveyFile | null,
  surveyError: null as string | null,
  surveyMatch: null as ReturnType<typeof surveyMatchSummary> | null,
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

  addSurvey: async (path) => {
    set({ busy: true, surveyError: null, surveyMatch: null });
    try {
      const res = await rpc.surveyParse({ file_path: path });
      const nQuestions = res.survey.questions.filter((q) => !q.in_trash && q.columns.length).length;
      set({ busy: false, survey: { path, fileName: baseName(path), survey: res.survey, nQuestions, issues: res.issues } });
      return true;
    } catch (e) {
      set({ busy: false, surveyError: describeSurveyError(e) });
      return false;
    }
  },

  removeSurvey: () => set({ survey: null, surveyError: null, surveyMatch: null }),

  checkSurvey: async () => {
    const { survey, preview, decisions } = get();
    if (!survey || !preview || !decisions) return;
    try {
      const res = await rpc.surveySuggest({ survey: survey.survey, variables: surveyMatchVariables(preview, decisions) });
      if (get().survey === survey) set({ surveyMatch: surveyMatchSummary(res) });
    } catch {
      // The count is informational; the import itself reports real problems.
    }
  },

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
    if (d) set({ decisions: { ...d, ...patch }, ...(patch.dropColumns ? { surveyMatch: null } : {}) });
  },

  commit: async () => {
    const { preview, decisions, survey } = get();
    if (!preview || !decisions) return false;
    set({ busy: true, error: null });
    try {
      const params = buildImportParams(preview, decisions);
      const res = await rpc.importDataset(survey ? { ...params, survey: { file_path: survey.path } } : params);
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
      let suggestions: SurveySuggestResult | null = null;
      let surveyWarning: string | null = null;
      if (survey) {
        try {
          ({ meta, suggestions } = await fillFromSurvey(meta, survey.survey));
        } catch (e) {
          surveyWarning = `Your data was imported, but Statly couldn't fill in details from ${survey.fileName}: ${describeRpcError(e)}`;
        }
      }
      set({ busy: false, result: { meta, linkReport, survey: suggestions, surveyWarning } });
      return true;
    } catch (e) {
      set({ busy: false, error: describeRpcError(e) });
      return false;
    }
  },
}));

/**
 * After an import with a survey file: fill in empty labels, question wording and answer choices as
 * one undoable edit ("Filled in from your survey"), and hand the suggestions to the Variable
 * Interview so it opens pre-filled (roles, levels, reverse hints, scales). Returns the current meta.
 */
async function fillFromSurvey(meta: DatasetMeta, survey: Survey): Promise<{ meta: DatasetMeta; suggestions: SurveySuggestResult }> {
  const suggestions = await rpc.surveySuggest({ dataset_id: meta.dataset_id, snapshot_id: meta.snapshot_id, survey, variables: null });
  const patches = surveyPatches(meta, suggestions);
  if (patches.length) await edits.updateVariables(patches, "Filled in from your survey", { quiet: true });
  const current = useDatasetStore.getState().meta ?? meta;
  useInterview.getState().seedSurvey(current.dataset_id, suggestions);
  return { meta: current, suggestions };
}

/** The engine explains an unreadable survey file in plain words (not JSON, no SurveyElements, ...); the generic text is about CSV/Excel. */
function describeSurveyError(e: unknown): string {
  const err = e as { kind?: string; code?: number; message?: string };
  if (err?.kind === "rpc" && err.code === RpcErrorCode.FileUnreadable && err.message) {
    return `${err.message} Choose the .qsf file Qualtrics exported (Tools → Import/Export → Export Survey).`;
  }
  return describeRpcError(e);
}
