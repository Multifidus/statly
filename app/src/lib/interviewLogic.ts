/**
 * Variable Interview (SPEC §6) step logic, kept pure for testing: grouping columns into
 * questions ("units"), best-guess roles and levels, the dynamic step list, and turning the
 * user's answers into engine edits.
 */
import type { CellValue, DatasetMeta, MeasurementLevel, ValueLabel, VariableRole, VariableSchema } from "@/contracts";
import type { AnswerKeyEntry, ScaleSpec, VariablePatch } from "@/lib/variablesRpc";

// --- units -------------------------------------------------------------------------------

export type UnitKind = "single" | "matrix" | "multiselect" | "group";

/** One interview question: a single column, or several columns asked about together. */
export interface Unit {
  id: string;
  kind: UnitKind;
  /** Short heading, e.g. "Q5 (6 items)". */
  title: string;
  names: string[];
  questionText: string | null;
}

const MATRIX_RE = /^(.+?)_(\d+)$/;

/** Variables the interview asks about: not survey-system metadata, not calculated, not the stacking Time column. */
export function interviewVariables(meta: DatasetMeta): VariableSchema[] {
  const timeVar = meta.stacking?.time_variable;
  return [...meta.variables]
    .sort((a, b) => a.display_order - b.display_order)
    .filter((v) => !v.is_metadata && !v.computed && v.name !== timeVar);
}

function stem(text: string | null): string | null {
  if (!text) return null;
  const i = text.lastIndexOf(" - ");
  return i > 0 ? text.slice(0, i) : text;
}

/**
 * Group columns into questions: engine-suggested scales (Qualtrics matrix), multi-select
 * indicator families (same source column), and other Qualtrics `Qn_k` families of 2+ columns
 * with the same storage type. Everything else is asked about one column at a time.
 */
export function buildUnits(meta: DatasetMeta): Unit[] {
  const vars = interviewVariables(meta);
  const byName = new Map(vars.map((v) => [v.name, v]));
  const assigned = new Map<string, string>();
  const groups = new Map<string, { kind: UnitKind; names: string[]; title: string; questionText: string | null }>();

  for (const s of meta.scales) {
    const names = s.items.filter((n) => byName.has(n) && !assigned.has(n));
    if (names.length < 2) continue;
    const id = `scale:${s.id}`;
    names.forEach((n) => assigned.set(n, id));
    groups.set(id, { kind: "matrix", names, title: `${s.name} (${names.length} items)`, questionText: stem(byName.get(names[0])!.question_text) });
  }
  for (const v of vars) {
    const src = v.sources[0]?.original_column_name;
    const indicator = v.value_labels.length === 2 && v.value_labels.every((l, i) => l.value === i) && v.value_labels[1].label === "Selected";
    if (!src || src === v.name || assigned.has(v.name) || !indicator) continue;
    const id = `multi:${src}`;
    if (!groups.has(id)) {
      groups.set(id, { kind: "multiselect", names: [], title: `${src} (select all that apply)`, questionText: byName.get(src)?.question_text ?? stem(v.question_text) });
      if (byName.has(src) && !assigned.has(src)) {
        assigned.set(src, id);
        groups.get(id)!.names.push(src);
      }
    }
    assigned.set(v.name, id);
    groups.get(id)!.names.push(v.name);
  }
  const families = new Map<string, VariableSchema[]>();
  for (const v of vars) {
    if (assigned.has(v.name) || /_TEXT$/i.test(v.name)) continue;
    const m = MATRIX_RE.exec(v.name);
    if (!m) continue;
    const key = `${m[1]}|${v.dtype}`;
    families.set(key, [...(families.get(key) ?? []), v]);
  }
  for (const [key, members] of families) {
    if (members.length < 2) continue;
    const prefix = key.split("|")[0];
    const id = `group:${prefix}`;
    if (groups.has(id)) continue;
    members.forEach((v) => assigned.set(v.name, id));
    groups.set(id, { kind: "group", names: members.map((v) => v.name), title: `${prefix} (${members.length} parts)`, questionText: stem(members[0].question_text) });
  }

  const units: Unit[] = [];
  const emitted = new Set<string>();
  for (const v of vars) {
    const gid = assigned.get(v.name);
    if (gid) {
      if (emitted.has(gid)) continue;
      emitted.add(gid);
      const g = groups.get(gid)!;
      units.push({ id: gid, kind: g.kind, title: g.title, names: g.names, questionText: g.questionText });
    } else {
      units.push({ id: `var:${v.name}`, kind: "single", title: v.name, names: [v.name], questionText: v.question_text ?? v.label });
    }
  }
  return units;
}

// --- column stats (from a page of rows) ---------------------------------------------------

export interface ColumnStats {
  /** Distinct non-blank values in first-seen order (capped). */
  distinct: (string | number | boolean)[];
  nDistinct: number;
  nNonBlank: number;
  nRows: number;
}

const DISTINCT_CAP = 60;

export function columnStats(columns: string[], rows: CellValue[][], missingCodes: Record<string, (number | string)[]> = {}): Record<string, ColumnStats> {
  const out: Record<string, ColumnStats> = {};
  columns.forEach((c, j) => {
    const codes = new Set((missingCodes[c] ?? []).map(String));
    const seen = new Map<string, string | number | boolean>();
    let nonBlank = 0;
    for (const r of rows) {
      const x = r[j];
      if (x === null || x === "" || codes.has(String(x))) continue;
      nonBlank++;
      const k = String(x).trim();
      if (!seen.has(k)) seen.set(k, typeof x === "string" ? x.trim() : x);
    }
    out[c] = { distinct: [...seen.values()].slice(0, DISTINCT_CAP), nDistinct: seen.size, nNonBlank: nonBlank, nRows: rows.length };
  });
  return out;
}

// --- guesses ------------------------------------------------------------------------------

export const ROLE_OPTIONS: { value: VariableRole; title: string; description: string }[] = [
  { value: "identifier", title: "Identifier (ID)", description: "A code that tells people apart, like a student ID." },
  { value: "group", title: "Group or cohort", description: "Which group someone is in, like control vs. intervention, or program." },
  { value: "time", title: "Time point", description: "When the answer was given, like pre, post or follow-up." },
  { value: "test_item", title: "Test question", description: "One question on a quiz or test that has a right answer." },
  { value: "test_total", title: "Test total score", description: "A score that adds up a whole test." },
  { value: "likert_item", title: "Survey (Likert) item", description: "An agree/disagree or rating question, like 1 = Strongly disagree to 5 = Strongly agree." },
  { value: "demographic", title: "Background / demographic", description: "Facts about the person, like grade level, age or which strategies they used." },
  { value: "open_text", title: "Open-ended text", description: "Answers people typed in their own words." },
  { value: "ignore", title: "Ignore", description: "Keep the column, but leave it out of analyses." },
];

export const LEVEL_OPTIONS: { value: MeasurementLevel; title: string; description: string }[] = [
  { value: "nominal", title: "Categories (nominal)", description: "Names with no order, like school or group. Example: Control, Intervention A, Intervention B." },
  { value: "ordinal", title: "Ordered categories (ordinal)", description: "Categories with an order but uneven steps. Example: Strongly disagree … Strongly agree." },
  { value: "continuous", title: "Numbers (continuous)", description: "Amounts where the steps are equal and averages make sense. Example: test score 0–100." },
];

export const roleTitle = (r: VariableRole) =>
  r === "scale_score" ? "Scale score" : r === "unassigned" ? "Not set" : (ROLE_OPTIONS.find((o) => o.value === r)?.title ?? r);

const SCORE_TEXT = /\b(score|total|points|grade|marks?)\b/i;
const ID_TEXT = /\b(id|identifier|code)\b/i;

/** Best-guess role for a unit (SPEC §6: pre-fill, the user confirms). */
export function guessRole(unit: Unit, vars: VariableSchema[], stats: Record<string, ColumnStats>): VariableRole {
  const first = vars[0];
  if (vars.every((v) => v.role !== "unassigned")) {
    const r = first.role;
    return r === "scale_score" ? "ignore" : r;
  }
  if (unit.kind === "matrix") return "likert_item";
  if (unit.kind === "multiselect") return "demographic";
  if (/^SC\d+$/i.test(first.name)) return "test_total";
  if (/_TEXT$/i.test(first.name)) return "open_text";
  const st = stats[first.name];
  const text = `${first.question_text ?? ""} ${first.label ?? ""}`;
  if (unit.kind === "group") {
    if (first.dtype === "string") return "test_item";
    if (first.level === "ordinal") return "likert_item";
    return "test_item";
  }
  if (first.dtype === "string") {
    if (!st || st.nNonBlank === 0) return "open_text";
    const unique = st.nDistinct / Math.max(1, st.nNonBlank);
    if (ID_TEXT.test(text) && unique > 0.3) return "identifier";
    if (st.nDistinct <= 12) return "group";
    if (unique > 0.9 && st.distinct.every((d) => String(d).length <= 24 && !/\s/.test(String(d)))) return "identifier";
    return "open_text";
  }
  if (first.level === "ordinal") return first.value_labels.length || (st && st.nDistinct <= 7) ? "likert_item" : "demographic";
  if (SCORE_TEXT.test(text)) return "test_total";
  return "demographic";
}

/** Best-guess measurement level from the role, dtype and number of distinct values. */
export function guessLevel(role: VariableRole, vars: VariableSchema[], stats: Record<string, ColumnStats>): MeasurementLevel {
  const first = vars[0];
  switch (role) {
    case "likert_item":
    case "time":
      return "ordinal";
    case "test_total":
    case "scale_score":
      return "continuous";
    case "identifier":
    case "open_text":
    case "test_item":
      return "nominal";
    default: {
      if (first.dtype === "string" || first.dtype === "boolean") return "nominal";
      const st = stats[first.name];
      if (first.level === "ordinal" && st && st.nDistinct <= 7) return "ordinal";
      return st && st.nDistinct > 10 ? "continuous" : first.level;
    }
  }
}

// --- draft + steps ------------------------------------------------------------------------

export interface UnitAnswer {
  role: VariableRole;
  level: MeasurementLevel;
  /** Shared ordered value labels for the unit (null = leave as is). */
  valueLabels: ValueLabel[] | null;
}

export interface DraftScale {
  key: string;
  /** Existing DatasetMeta scale id (matrix suggestion or earlier scale); null = new. */
  id: string | null;
  name: string;
  items: string[];
  method: "mean" | "sum";
  /** null = default (half the items, rounded up, for a mean; all items for a sum). */
  minItems: number | null;
}

export type KeyMode = "key" | "scored" | "skip";

export interface Draft {
  answers: Record<string, UnitAnswer>;
  reverse: Record<string, boolean>;
  scales: DraftScale[];
  keyMode: KeyMode;
  /** item -> correct answer(s) as strings; empty = not set yet. */
  key: Record<string, string[]>;
}

export type StepId = string; // "intro" | "role:<unit>" | "level:<unit>" | "labels:<unit>" | "answer_key" | "scales" | "scoring" | "summary"

const NO_LEVEL_QUESTION: VariableRole[] = ["identifier", "open_text", "ignore", "time", "test_item"];
const LABEL_ROLES: VariableRole[] = ["group", "likert_item", "demographic", "time"];

export function needsLevel(a: UnitAnswer): boolean {
  return !NO_LEVEL_QUESTION.includes(a.role);
}

/** Initial value labels for a unit's labels step, or null when the step doesn't apply. */
export function initialLabels(unit: Unit, vars: VariableSchema[], stats: Record<string, ColumnStats>): ValueLabel[] | null {
  if (unit.kind === "multiselect") return null;
  const withLabels = vars.filter((v) => v.value_labels.length);
  if (withLabels.length) {
    const first = JSON.stringify(withLabels[0].value_labels);
    if (withLabels.length !== vars.length || withLabels.some((v) => JSON.stringify(v.value_labels) !== first)) return null;
    return withLabels[0].value_labels.map((l) => ({ ...l }));
  }
  const values = new Map<string, string | number>();
  for (const v of vars) {
    const st = stats[v.name];
    if (!st || st.nDistinct > 12) return null;
    for (const d of st.distinct) if (typeof d !== "boolean") values.set(String(d), d);
  }
  if (!values.size || values.size > 12) return null;
  const numeric = vars.every((v) => v.dtype === "integer" || v.dtype === "float");
  const list = [...values.values()];
  if (numeric) list.sort((a, b) => Number(a) - Number(b));
  else list.sort((a, b) => String(a).localeCompare(String(b)));
  return list.map((x) => ({ value: x, label: String(x) }));
}

export function hasLabelsStep(a: UnitAnswer, labels: ValueLabel[] | null): boolean {
  return LABEL_ROLES.includes(a.role) && a.level !== "continuous" && !!labels && labels.length > 1;
}

/** Raw-choice test questions (need an answer key) and already-scored numeric ones. */
export function testItems(units: Unit[], draft: Draft, byName: Map<string, VariableSchema>) {
  const names = units.filter((u) => draft.answers[u.id]?.role === "test_item").flatMap((u) => u.names);
  return {
    raw: names.filter((n) => byName.get(n)?.dtype === "string"),
    scored: names.filter((n) => byName.get(n)?.dtype !== "string"),
  };
}

export function likertItems(units: Unit[], draft: Draft, byName: Map<string, VariableSchema>): string[] {
  return units
    .filter((u) => draft.answers[u.id]?.role === "likert_item")
    .flatMap((u) => u.names)
    .filter((n) => ["integer", "float", "boolean"].includes(byName.get(n)?.dtype ?? ""));
}

/** The dynamic list of steps: later questions depend on earlier answers. */
export function interviewSteps(units: Unit[], draft: Draft, byName: Map<string, VariableSchema>, labelsFor: (u: Unit) => ValueLabel[] | null): StepId[] {
  const steps: StepId[] = ["intro"];
  for (const u of units) steps.push(`role:${u.id}`);
  for (const u of units) {
    const a = draft.answers[u.id];
    if (a && needsLevel(a)) steps.push(`level:${u.id}`);
  }
  for (const u of units) {
    const a = draft.answers[u.id];
    if (a && hasLabelsStep(a, a.valueLabels ?? labelsFor(u))) steps.push(`labels:${u.id}`);
  }
  const t = testItems(units, draft, byName);
  if (t.raw.length || t.scored.length) steps.push("answer_key");
  if (likertItems(units, draft, byName).length >= 2) steps.push("scales");
  if (activeScales(draft, units, byName).length) steps.push("scoring");
  steps.push("summary");
  return steps;
}

/** Scales that will be scored: items restricted to current Likert items, at least two left. */
export function activeScales(draft: Draft, units: Unit[], byName: Map<string, VariableSchema>): DraftScale[] {
  const likert = new Set(likertItems(units, draft, byName));
  return draft.scales.map((s) => ({ ...s, items: s.items.filter((i) => likert.has(i)) })).filter((s) => s.items.length >= 2 && s.name.trim());
}

export function defaultMinItems(nItems: number, method: "mean" | "sum"): number {
  return method === "mean" ? Math.max(1, Math.ceil(nItems / 2)) : Math.max(1, nItems);
}

/** Move an item into a scale (or out of all scales with target null), keeping one scale per item. */
export function moveItem(scales: DraftScale[], item: string, target: string | null, index?: number): DraftScale[] {
  return scales.map((s) => {
    const items = s.items.filter((i) => i !== item);
    if (s.key === target) {
      const at = index === undefined ? items.length : Math.max(0, Math.min(index, items.length));
      items.splice(at, 0, item);
    }
    return { ...s, items };
  });
}

export function reorder<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

// --- applying the answers -----------------------------------------------------------------

export interface InterviewPlan {
  updates: VariablePatch[];
  deleteScales: string[];
  upsertScales: ScaleSpec[];
  key: AnswerKeyEntry[] | null;
}

const sameLabels = (a: ValueLabel[], b: ValueLabel[]) => JSON.stringify(a) === JSON.stringify(b);

/** Turn the draft into engine calls, sending only what changed. */
export function buildPlan(meta: DatasetMeta, units: Unit[], draft: Draft, labelsFor: (u: Unit) => ValueLabel[] | null): InterviewPlan {
  const byName = new Map(meta.variables.map((v) => [v.name, v]));
  const likert = new Set(likertItems(units, draft, byName));
  const updates: VariablePatch[] = [];
  for (const u of units) {
    const a = draft.answers[u.id];
    if (!a) continue;
    const labels = hasLabelsStep(a, a.valueLabels ?? labelsFor(u)) ? (a.valueLabels ?? labelsFor(u)) : null;
    for (const name of u.names) {
      const v = byName.get(name);
      if (!v) continue;
      const p: VariablePatch = { name };
      if (v.role !== a.role) p.role = a.role;
      if (v.level !== a.level) p.level = a.level;
      if (labels && !sameLabels(v.value_labels, labels)) p.value_labels = labels;
      const rev = likert.has(name) ? !!draft.reverse[name] : v.reverse_coded;
      if (rev !== v.reverse_coded) p.reverse_coded = rev;
      if (Object.keys(p).length > 1) updates.push(p);
    }
  }
  const active = activeScales(draft, units, byName);
  const keep = new Set(active.map((s) => s.id).filter(Boolean));
  const deleteScales = meta.scales.filter((s) => !keep.has(s.id) && s.score_variable).map((s) => s.id);
  const upsertScales: ScaleSpec[] = active.map((s) => {
    const spec: ScaleSpec = { id: s.id, name: s.name.trim(), items: s.items, scoring_method: s.method };
    spec.min_items = s.minItems ?? defaultMinItems(s.items.length, s.method);
    return spec;
  });
  let key: AnswerKeyEntry[] | null = null;
  const t = testItems(units, draft, byName);
  if (draft.keyMode === "key" && t.raw.length) {
    const entries = t.raw.filter((n) => (draft.key[n] ?? []).length).map((n) => ({ item: n, correct: draft.key[n] }));
    const scored = t.scored.map((n) => ({ item: n, correct: null }));
    key = entries.length ? [...entries, ...scored] : null;
  } else if (draft.keyMode === "scored" && t.scored.length >= 2) {
    key = t.scored.map((n) => ({ item: n, correct: null }));
  }
  return { updates, deleteScales, upsertScales, key };
}

/** Initial draft: best guesses for every unit, scales from the engine's suggestions. */
export function initialDraft(meta: DatasetMeta, units: Unit[], stats: Record<string, ColumnStats>): Draft {
  const byName = new Map(meta.variables.map((v) => [v.name, v]));
  const answers: Record<string, UnitAnswer> = {};
  for (const u of units) {
    const vars = u.names.map((n) => byName.get(n)!).filter(Boolean);
    const role = guessRole(u, vars, stats);
    answers[u.id] = { role, level: guessLevel(role, vars, stats), valueLabels: null };
  }
  const reverse: Record<string, boolean> = {};
  for (const v of meta.variables) if (v.reverse_coded) reverse[v.name] = true;
  const scales: DraftScale[] = meta.scales.map((s) => ({
    key: s.id,
    id: s.id,
    name: s.name,
    items: [...s.items],
    method: s.scoring_method,
    minItems: s.min_items,
  }));
  return { answers, reverse, scales, keyMode: "key", key: {} };
}

/** Plain-language checks that block moving on from a step (null = OK). */
export function stepProblem(step: StepId, draft: Draft, units: Unit[], byName: Map<string, VariableSchema>): string | null {
  if (step === "answer_key" && draft.keyMode === "key") {
    const t = testItems(units, draft, byName);
    if (t.raw.length && !t.raw.some((n) => (draft.key[n] ?? []).length)) {
      return "Enter at least one correct answer, load an answer key, or choose to skip scoring for now.";
    }
  }
  if (step === "scales") {
    const names = draft.scales.filter((s) => s.items.length).map((s) => s.name.trim().toLowerCase());
    if (names.some((n) => !n)) return "Give every scale a name.";
    if (new Set(names).size !== names.length) return "Two scales have the same name.";
    if (draft.scales.some((s) => s.items.length === 1)) return "A scale needs at least two items (or none).";
  }
  if (step === "scoring") {
    for (const s of activeScales(draft, units, byName)) {
      if (s.minItems !== null && (s.minItems < 1 || s.minItems > s.items.length)) {
        return `For ${s.name}, the minimum must be between 1 and ${s.items.length}.`;
      }
    }
  }
  return null;
}
