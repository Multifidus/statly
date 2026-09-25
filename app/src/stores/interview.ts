/**
 * Variable Interview state (SPEC §6): one question at a time over the current dataset. Answers
 * stay in a local draft until the summary step's "Finish", which applies them as a few engine
 * edits (each one an undo/redo step): variable roles/levels/labels/reverse-coding, scales, and
 * the answer key.
 */
import { create } from "zustand";
import type { ValueLabel, VariableSchema } from "@/contracts";
import {
  buildPlan,
  buildUnits,
  columnStats,
  guessLevel,
  initialDraft,
  initialLabels,
  interviewSteps,
  interviewVariables,
  stepProblem,
  type ColumnStats,
  type Draft,
  type StepId,
  type Unit,
  type UnitAnswer,
} from "@/lib/interviewLogic";
import { describeRpcError, rpc } from "@/lib/rpc";
import { EditError, edits } from "@/lib/variableEdits";
import { useDatasetStore } from "@/stores/dataset";

/** Rows sampled to guess roles/levels and list answer choices. */
export const SAMPLE_ROWS = 2000;

export type InterviewStatus = "idle" | "loading" | "ready" | "applying" | "done";

interface InterviewState {
  status: InterviewStatus;
  datasetId: string | null;
  units: Unit[];
  stats: Record<string, ColumnStats>;
  draft: Draft | null;
  step: StepId;
  error: string | null;
  /** Engine warnings collected while applying. */
  warnings: string[];

  start: () => Promise<void>;
  setAnswer: (unitId: string, patch: Partial<UnitAnswer>) => void;
  setDraft: (patch: Partial<Draft>) => void;
  steps: () => StepId[];
  labelsFor: (u: Unit) => ValueLabel[] | null;
  problem: () => string | null;
  goTo: (step: StepId) => void;
  next: () => void;
  back: () => void;
  finish: () => Promise<boolean>;
  reset: () => void;
}

const byNameOf = (): Map<string, VariableSchema> =>
  new Map((useDatasetStore.getState().meta?.variables ?? []).map((v) => [v.name, v]));

export const useInterview = create<InterviewState>((set, get) => ({
  status: "idle",
  datasetId: null,
  units: [],
  stats: {},
  draft: null,
  step: "intro",
  error: null,
  warnings: [],

  start: async () => {
    const meta = useDatasetStore.getState().meta;
    if (!meta) return;
    set({ status: "loading", error: null, warnings: [], datasetId: meta.dataset_id, step: "intro" });
    try {
      const vars = interviewVariables(meta);
      const columns = vars.map((v) => v.name);
      const res = columns.length
        ? await rpc.rows({ dataset_id: meta.dataset_id, snapshot_id: meta.snapshot_id, offset: 0, limit: SAMPLE_ROWS, columns, sort: null })
        : { columns: [], rows: [] };
      const codes = Object.fromEntries(vars.map((v) => [v.name, v.missing_codes]));
      const stats = columnStats(res.columns, res.rows, codes);
      const units = buildUnits(meta);
      set({ status: "ready", units, stats, draft: initialDraft(meta, units, stats), step: "intro" });
    } catch (e) {
      set({ status: "idle", error: describeRpcError(e) });
    }
  },

  setAnswer: (unitId, patch) => {
    const d = get().draft;
    if (!d) return;
    const cur = d.answers[unitId];
    const next = { ...cur, ...patch };
    // A new role re-derives the level guess unless the level itself was changed.
    if (patch.role && patch.role !== cur.role && !patch.level) {
      const unit = get().units.find((u) => u.id === unitId);
      const byName = byNameOf();
      const vars = (unit?.names ?? []).map((n) => byName.get(n)!).filter(Boolean);
      if (vars.length) next.level = guessLevel(patch.role, vars, get().stats);
    }
    set({ draft: { ...d, answers: { ...d.answers, [unitId]: next } } });
  },

  setDraft: (patch) => {
    const d = get().draft;
    if (d) set({ draft: { ...d, ...patch } });
  },

  labelsFor: (u) => {
    const byName = byNameOf();
    return initialLabels(u, u.names.map((n) => byName.get(n)!).filter(Boolean), get().stats);
  },

  steps: () => {
    const { draft, units } = get();
    if (!draft) return ["intro"];
    return interviewSteps(units, draft, byNameOf(), get().labelsFor);
  },

  problem: () => {
    const { draft, units, step } = get();
    return draft ? stepProblem(step, draft, units, byNameOf()) : null;
  },

  goTo: (step) => set({ step, error: null }),

  next: () => {
    const steps = get().steps();
    const i = steps.indexOf(get().step);
    if (i >= 0 && i < steps.length - 1) set({ step: steps[i + 1], error: null });
  },

  back: () => {
    const steps = get().steps();
    const i = steps.indexOf(get().step);
    if (i > 0) set({ step: steps[i - 1], error: null });
  },

  finish: async () => {
    const meta = useDatasetStore.getState().meta;
    const { draft, units } = get();
    if (!meta || !draft) return false;
    const plan = buildPlan(meta, units, draft, get().labelsFor);
    set({ status: "applying", error: null });
    const warnings: string[] = [];
    const collect = (ws: { message: string }[]) => warnings.push(...ws.map((w) => w.message));
    try {
      if (plan.updates.length) collect(await edits.updateVariables(plan.updates, "Variable interview answers", { quiet: true }));
      for (const id of plan.deleteScales) collect(await edits.deleteScale(id));
      for (const s of plan.upsertScales) collect(await edits.upsertScale(s, { quiet: true }));
      if (plan.key) collect(await edits.scoreItems(plan.key, null, { quiet: true }));
      set({ status: "done", warnings: [...new Set(warnings)] });
      return true;
    } catch (e) {
      set({ status: "ready", error: e instanceof EditError ? e.message : describeRpcError(e), warnings });
      return false;
    }
  },

  reset: () => set({ status: "idle", datasetId: null, units: [], stats: {}, draft: null, step: "intro", error: null, warnings: [] }),
}));
