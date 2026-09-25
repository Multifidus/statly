import { create } from "zustand";
import type { ProjectFile, RecoverableAutosave } from "@/contracts";
import { rpc } from "@/lib/rpc";
import { useDatasetStore } from "@/stores/dataset";

export const APP_VERSION = "0.1.0";
/** How often a dirty project is copied to the autosave dir. */
export const AUTOSAVE_INTERVAL_MS = 60_000;

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";
export type GuardChoice = "save" | "discard" | "cancel";

interface ProjectState {
  /** Frontend-held ProjectFile; the engine substitutes the authoritative dataset_meta on save. */
  project: ProjectFile | null;
  /** Real .statly path; null until first saved. */
  path: string | null;
  dirty: boolean;
  /** Opened from a crash-recovery autosave and not yet saved. */
  recovered: boolean;
  autosave: { status: AutosaveStatus; at: string | null; error: string | null };
  recoverable: RecoverableAutosave[];
  /** Unsaved-changes prompt awaiting the user's answer (rendered by UnsavedChangesDialog). */
  guard: { reason: string; resolve: (c: GuardChoice) => void } | null;

  newProject: (name?: string) => ProjectFile;
  markDirty: () => void;
  /** Build the ProjectFile to send with save/autosave (current dataset meta folded in). */
  snapshot: () => ProjectFile | null;
  saveTo: (path: string) => Promise<void>;
  open: (path: string) => Promise<ProjectFile>;
  autosaveNow: (autosaveDir: string) => Promise<void>;
  loadRecoverable: (autosaveDir: string) => Promise<void>;
  recover: (item: RecoverableAutosave) => Promise<ProjectFile>;
  discardRecoverable: (item: RecoverableAutosave) => Promise<void>;
  /** Ask the user what to do with unsaved changes. Resolves immediately with "discard" when clean. */
  confirmUnsaved: (reason: string) => Promise<GuardChoice>;
  answerGuard: (c: GuardChoice) => void;
  close: () => void;
  /** Phase 2 hooks (undo/redo); intentionally no-ops for now. */
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export function makeProject(name = "Untitled project", now = new Date().toISOString()): ProjectFile {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `p-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  return {
    schema_version: 1,
    project_id: id,
    name,
    app_version: APP_VERSION,
    engine_version: "",
    created_at: now,
    modified_at: now,
    dataset_meta: null,
    data_path: null,
    test_log: [],
    test_families: [],
    chart_specs: [],
    tag_codebook: null,
    study_plan: null,
    ui_state: { active_view: null },
  };
}

export function projectNameFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.statly$/i, "");
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  path: null,
  dirty: false,
  recovered: false,
  autosave: { status: "idle", at: null, error: null },
  recoverable: [],
  guard: null,

  newProject: (name) => {
    const project = makeProject(name);
    useDatasetStore.getState().clear();
    set({ project, path: null, dirty: false, recovered: false, autosave: { status: "idle", at: null, error: null } });
    return project;
  },

  markDirty: () => {
    if (get().project) set({ dirty: true });
  },

  snapshot: () => {
    const p = get().project;
    if (!p) return null;
    const meta = useDatasetStore.getState().meta;
    return { ...p, dataset_meta: meta, data_path: meta ? "data/dataset.parquet" : null };
  },

  saveTo: async (path) => {
    const project = get().snapshot();
    if (!project) throw new Error("No project is open.");
    const named = get().path === path ? project : { ...project, name: projectNameFromPath(path) };
    const res = await rpc.saveProject({ path, project: named });
    useDatasetStore.getState().setMeta(res.project.dataset_meta);
    set({
      project: res.project,
      path: res.path,
      dirty: false,
      recovered: false,
      autosave: { status: "idle", at: null, error: null },
      recoverable: get().recoverable.filter((r) => r.marker.project_id !== res.project.project_id),
    });
  },

  open: async (path) => {
    const res = await rpc.loadProject({ path });
    useDatasetStore.getState().setMeta(res.project.dataset_meta);
    set({
      project: res.project,
      path: res.is_autosave ? (res.autosave_marker?.original_path ?? null) : path,
      dirty: res.is_autosave,
      recovered: res.is_autosave,
      autosave: { status: "idle", at: null, error: null },
    });
    return res.project;
  },

  autosaveNow: async (autosaveDir) => {
    const { dirty } = get();
    const project = get().snapshot();
    if (!project || !dirty) return;
    set({ autosave: { ...get().autosave, status: "saving", error: null } });
    try {
      const res = await rpc.autosave({ autosave_dir: autosaveDir, original_path: get().path, project });
      set({ autosave: { status: "saved", at: res.saved_at, error: null } });
    } catch (e) {
      set({ autosave: { status: "error", at: get().autosave.at, error: String((e as { message?: string })?.message ?? e) } });
    }
  },

  loadRecoverable: async (autosaveDir) => {
    try {
      const res = await rpc.recoverable({ autosave_dir: autosaveDir });
      set({ recoverable: res.autosaves });
    } catch {
      set({ recoverable: [] });
    }
  },

  recover: async (item) => {
    const project = await get().open(item.autosave_path);
    set({ recoverable: get().recoverable.filter((r) => r.autosave_path !== item.autosave_path) });
    return project;
  },

  discardRecoverable: async (item) => {
    await rpc.discardAutosave({ autosave_path: item.autosave_path });
    set({ recoverable: get().recoverable.filter((r) => r.autosave_path !== item.autosave_path) });
  },

  confirmUnsaved: (reason) => {
    if (!get().dirty) return Promise.resolve("discard");
    return new Promise<GuardChoice>((resolve) => {
      get().guard?.resolve("cancel");
      set({ guard: { reason, resolve } });
    });
  },

  answerGuard: (c) => {
    const g = get().guard;
    set({ guard: null });
    g?.resolve(c);
  },

  close: () => {
    useDatasetStore.getState().clear();
    set({ project: null, path: null, dirty: false, recovered: false, autosave: { status: "idle", at: null, error: null } });
  },

  canUndo: () => false,
  canRedo: () => false,
}));
