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
  isKnowledge,
  knowledgeCandidates,
  setKnowledge as setKnowledgeIn,
  stepProblem,
  type KnowledgeCandidate,
  type SurveyChoiceInfo,
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
 * - `knowledge[item]`: a knowledge question ticked with its correct answer from the survey's scoring
 */
export interface FilledFrom {
  units: Record<string, FillSource>;
  reverse: Record<string, FillSource>;
  scales: Record<string, FillSource>;
  knowledge: Record<string, FillSource>;
}

const noFills = (): FilledFrom => ({ units: {}, reverse: {}, scales: {}, knowledge: {} });

/** Per-column survey facts the knowledge step uses (question kind, choices, scored answer). */
export function surveyChoiceInfo(s: SurveySuggestResult | null | undefined): Record<string, SurveyChoiceInfo> {
  const out: Record<string, SurveyChoiceInfo> = {};
  for (const c of s?.columns ?? []) {
    out[c.name] = { kind: c.question_kind ?? null, choices: c.value_labels, correct: c.correct_values ?? [] };
  }
  return out;
}

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
  stats: Record<string, ColumnStats> = {},
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
  let next: Draft = { ...draft, answers, reverse, scales };
  // Scored single-answer questions: tick them as knowledge questions with the survey's correct answer.
  if (full) {
    const graded = knowledgeCandidates(units, next, byName, stats, surveyChoiceInfo(s)).filter((c) => c.surveyCorrect.length);
    for (const c of graded) {
      const r = byName.get(c.name)?.role;
      if (r !== "unassigned" && r !== "test_item") continue;
      if (!isKnowledge(next, c)) next = setKnowledgeIn(next, units, c, true);
      next = { ...next, key: { ...next.key, [c.name]: c.surveyCorrect } };
      filled.knowledge[c.name] = "survey";
    }
  }
  return { draft: next, filledFrom: filled };
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
  /** Survey facts per column for the knowledge step (empty without a survey file). */
  survey: Record<string, SurveyChoiceInfo>;

  seedSurvey: (datasetId: string, suggestions: SurveySuggestResult) => void;

  start: () => Promise<void>;
  setAnswer: (unitId: string, patch: Partial<UnitAnswer>) => void;
  setDraft: (patch: Partial<Draft>) => void;
  /** Multiple-choice columns the knowledge step asks about. */
  candidates: () => KnowledgeCandidate[];
  /** Tick / untick a knowledge question. */
  setKnowledge: (name: string, on: boolean) => void;
  /** Pick a knowledge question's correct answer ("" = none); ticks it. */
  setCorrect: (name: string, value: string) => void;
  /** Fill several correct answers at once (from a key file); ticks those questions. */
  applyKey: (key: Record<string, string[]>) => void;
  /** "Skip": untick every knowledge question (they stay survey answers). */
  skipKnowledge: () => void;
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
  survey: {},

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
      if (seed) ({ draft, filledFrom } = applySurveySeed(meta, units, draft, seed.suggestions, seed.mode, stats));
      set({ status: "ready", units, stats, draft, filledFrom, survey: surveyChoiceInfo(seed?.suggestions), step: "intro" });
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

  candidates: () => {
    const { draft, units, stats, survey } = get();
    return draft ? knowledgeCandidates(units, draft, byNameOf(), stats, survey) : [];
  },

  setKnowledge: (name, on) => {
    const { draft, units, filledFrom } = get();
    const c = get().candidates().find((x) => x.name === name);
    if (!draft || !c || isKnowledge(draft, c) === on) return;
    const { [name]: _k, ...knowledge } = filledFrom.knowledge;
    const unitFills = { ...filledFrom.units };
    delete unitFills[c.unitId];
    set({ draft: setKnowledgeIn(draft, units, c, on), filledFrom: { ...filledFrom, knowledge, units: unitFills } });
  },

  setCorrect: (name, value) => {
    const { draft, units, filledFrom } = get();
    const c = get().candidates().find((x) => x.name === name);
    if (!draft || !c) return;
    let next = value && !isKnowledge(draft, c) ? setKnowledgeIn(draft, units, c, true) : draft;
    next = { ...next, key: { ...next.key, [name]: value ? [value] : [] } };
    const { [name]: _k, ...knowledge } = filledFrom.knowledge;
    set({ draft: next, filledFrom: { ...filledFrom, knowledge } });
  },

  applyKey: (key) => {
    const { draft, units, filledFrom } = get();
    if (!draft) return;
    const cands = get().candidates();
    let next = draft;
    const knowledge = { ...filledFrom.knowledge };
    for (const [name, values] of Object.entries(key)) {
      const c = cands.find((x) => x.name === name);
      if (!c || !values.length) continue;
      if (!isKnowledge(next, c)) next = setKnowledgeIn(next, units, c, true);
      next = { ...next, key: { ...next.key, [name]: values } };
      delete knowledge[name];
    }
    set({ draft: next, filledFrom: { ...filledFrom, knowledge } });
  },

  skipKnowledge: () => {
    const { units } = get();
    let next = get().draft;
    if (!next) return;
    for (const c of get().candidates()) if (isKnowledge(next, c)) next = setKnowledgeIn(next, units, c, false);
    set({ draft: next, filledFrom: { ...get().filledFrom, knowledge: {} } });
  },

  labelsFor: (u) => {
    const byName = byNameOf();
    return initialLabels(u, u.names.map((n) => byName.get(n)!).filter(Boolean), get().stats);
  },

  steps: () => {
    const { draft, units } = get();
    if (!draft) return ["intro"];
    return interviewSteps(units, draft, byNameOf(), get().labelsFor, get().candidates());
  },

  problem: () => {
    const { draft, units, step } = get();
    return draft ? stepProblem(step, draft, units, byNameOf(), knowledgeNames(get().candidates())) : null;
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
    const plan = buildPlan(meta, units, draft, get().labelsFor, knowledgeNames(get().candidates()));
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
    set({ status: "idle", datasetId: null, units: [], stats: {}, draft: null, step: "intro", error: null, warnings: [], filledFrom: noFills(), survey: {} }),
}));

/** Names of the knowledge-step candidates (what buildPlan / stepProblem treat as knowledge questions). */
export const knowledgeNames = (cands: KnowledgeCandidate[]) => new Set(cands.map((c) => c.name));

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
