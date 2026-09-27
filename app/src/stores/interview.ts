/**
 * Variable Interview state (SPEC §6): one question at a time over the current dataset. Answers
 * stay in a local draft until the summary step's "Finish", which applies them as a few engine
 * edits (each one an undo/redo step): variable roles/levels/labels/reverse-coding, scales, and
 * the answer key.
 *
 * Survey file (.qsf): the import seeds `surveySeed`; start() pre-fills roles, levels, reverse
 * hints and suggested scales from it for questions the user hasn't answered yet (variables still
 * `unassigned`), and records each pre-filled answer in `filledFrom` so the steps can say
 * "Filled in from your survey". Without an in-memory seed (e.g. after reopening a project) start()
 * asks the engine again, from the .qsf stored with the dataset.
 */
import { create } from "zustand";
import type { DatasetMeta, SurveySuggestResult, ValueLabel, VariableSchema } from "@/contracts";
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

/** Where a pre-filled interview answer came from. */
export type FillSource = "survey";

/**
 * Pre-filled answers, by what they belong to. The steps read these to show "Filled in from your
 * survey"; an entry is dropped as soon as the user changes that answer.
 * - `units[unit.id]`: the unit's role / level / answer choices (steps role:, level:, labels:)
 * - `reverse[item]`: the item's reverse-coding tick (scales step)
 * - `scales[draftScale.key]`: a suggested scale (scales step)
 */
export interface FilledFrom {
  units: Record<string, FillSource>;
  reverse: Record<string, FillSource>;
  scales: Record<string, FillSource>;
}

const noFills = (): FilledFrom => ({ units: {}, reverse: {}, scales: {} });

/**
 * Survey suggestions for the interview of one dataset. `full`: straight after the import, before
 * the user has finished an interview: answers are pre-filled. `annotate`: once an interview was
 * finished, or after reopening a project (Statly can't tell what the user already decided): nothing
 * is changed, answers that agree with the survey are only marked.
 */
export interface SurveySeed {
  datasetId: string;
  suggestions: SurveySuggestResult;
  mode: "full" | "annotate";
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Pre-fill (mode "full") or only mark (mode "annotate") a fresh draft from survey suggestions.
 * A unit is used only when the survey matched all of its columns. Never touches a variable whose
 * role was set to something other than the survey's suggestion.
 */
export function applySurveySeed(
  meta: DatasetMeta,
  units: Unit[],
  draft: Draft,
  s: SurveySuggestResult,
  mode: SurveySeed["mode"] = "full",
): { draft: Draft; filledFrom: FilledFrom } {
  const byName = new Map(meta.variables.map((v) => [v.name, v]));
  const sugg = new Map(s.columns.map((c) => [c.name, c]));
  const full = mode === "full";
  const filled = noFills();
  const answers = { ...draft.answers };
  for (const u of units) {
    const cols = u.names.map((n) => sugg.get(n));
    const cur = answers[u.id];
    if (!cur || cols.some((c) => !c)) continue;
    const roles = new Set(cols.map((c) => c!.role ?? null));
    const role = roles.size === 1 ? [...roles][0] : null;
    const levels = new Set(cols.map((c) => c!.level));
    const level = levels.size === 1 ? [...levels][0] : null;
    // A role already on the variables that isn't the survey's is the user's (or the engine's) call.
    const keepsRole = u.names.every((n) => {
      const r = byName.get(n)?.role;
      return r === "unassigned" || r === role;
    });
    if (full && keepsRole) {
      const next = { ...cur };
      if (role) next.role = role;
      if (level) next.level = level;
      answers[u.id] = next;
      filled.units[u.id] = "survey";
    } else if ((!role || cur.role === role) && (!level || cur.level === level)) {
      filled.units[u.id] = "survey";
    }
  }
  const reverse = { ...draft.reverse };
  for (const c of s.columns) {
    if (!c.reverse_hint || !byName.has(c.name)) continue;
    if (full && !byName.get(c.name)!.reverse_coded) reverse[c.name] = true;
    if (reverse[c.name]) filled.reverse[c.name] = "survey";
  }
  const scales = [...draft.scales];
  for (const sc of s.scales) {
    const items = sc.items.filter((n) => byName.has(n));
    const same = scales.find((d) => sameSet(d.items, items));
    if (same) {
      filled.scales[same.key] = "survey";
      continue;
    }
    if (!full || items.length < 2 || scales.some((d) => d.items.some((i) => items.includes(i)))) continue;
    const key = `survey:${sc.name}`;
    scales.push({ key, id: null, name: sc.label.trim().slice(0, 40), placeholderName: sc.name, items, method: "mean", minItems: null });
    filled.scales[key] = "survey";
  }
  return { draft: { ...draft, answers, reverse, scales }, filledFrom: filled };
}

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
  /** Survey suggestions for the next start() of that dataset (kept across reset()). */
  surveySeed: SurveySeed | null;
  /** Answers pre-filled from the survey (see FilledFrom). */
  filledFrom: FilledFrom;

  seedSurvey: (datasetId: string, suggestions: SurveySuggestResult) => void;

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
  surveySeed: null,
  filledFrom: noFills(),

  seedSurvey: (datasetId, suggestions) => set({ surveySeed: { datasetId, suggestions, mode: "full" } }),

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
      let draft = initialDraft(meta, units, stats);
      let filledFrom = noFills();
      const seed = await surveySuggestionsFor(meta, get().surveySeed);
      if (seed) ({ draft, filledFrom } = applySurveySeed(meta, units, draft, seed.suggestions, seed.mode));
      set({ status: "ready", units, stats, draft, filledFrom, step: "intro" });
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
    const { [unitId]: _dropped, ...units } = get().filledFrom.units;
    const changed = (Object.keys(patch) as (keyof UnitAnswer)[]).some((k) => JSON.stringify(cur?.[k]) !== JSON.stringify(next[k]));
    set({
      draft: { ...d, answers: { ...d.answers, [unitId]: next } },
      ...(changed ? { filledFrom: { ...get().filledFrom, units } } : {}),
    });
  },

  setDraft: (patch) => {
    const d = get().draft;
    if (!d) return;
    const f = get().filledFrom;
    const reverse = Object.fromEntries(Object.entries(f.reverse).filter(([n]) => !patch.reverse || !!patch.reverse[n] === !!d.reverse[n]));
    const keep = (key: string) => {
      if (!patch.scales) return true;
      const before = d.scales.find((x) => x.key === key);
      const after = patch.scales.find((x) => x.key === key);
      return JSON.stringify(before) === JSON.stringify(after);
    };
    const scales = Object.fromEntries(Object.entries(f.scales).filter(([k]) => keep(k)));
    set({ draft: { ...d, ...patch }, filledFrom: { ...f, reverse, scales } });
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
      // Answers are the user's now: a later run only marks what agrees with the survey.
      const seed = get().surveySeed;
      set({ status: "done", warnings: [...new Set(warnings)], ...(seed?.datasetId === meta.dataset_id ? { surveySeed: { ...seed, mode: "annotate" as const } } : {}) });
      return true;
    } catch (e) {
      set({ status: "ready", error: e instanceof EditError ? e.message : describeRpcError(e), warnings });
      return false;
    }
  },

  reset: () =>
    set({ status: "idle", datasetId: null, units: [], stats: {}, draft: null, step: "intro", error: null, warnings: [], filledFrom: noFills() }),
}));

/** The survey seed for this dataset: the import's, else re-derived (annotate only) from the stored .qsf; null if none. */
async function surveySuggestionsFor(meta: DatasetMeta, seed: SurveySeed | null): Promise<SurveySeed | null> {
  if (seed?.datasetId === meta.dataset_id) return seed;
  if (!meta.import_log.files.some((f) => f.role === "survey")) return null;
  try {
    const suggestions = await rpc.surveySuggest({ dataset_id: meta.dataset_id, snapshot_id: meta.snapshot_id, survey: null, variables: null });
    const fetched: SurveySeed = { datasetId: meta.dataset_id, suggestions, mode: "annotate" };
    useInterview.setState({ surveySeed: fetched });
    return fetched;
  } catch {
    return null; // pre-filling is a convenience; the interview works without it
  }
}
