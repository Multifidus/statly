/**
 * Variable Interview (SPEC §6) step logic, kept pure for testing: grouping columns into
 * questions ("units"), best-guess roles and levels, the dynamic step list, and turning the
 * user's answers into engine edits.
 */
import type { CellValue, DatasetMeta, MeasurementLevel, ValueLabel, VariableRole, VariableSchema } from "@/contracts";
import type { AnswerKeyEntry, ScaleSpec, VariablePatch } from "@/lib/variablesRpc";
import { CHOICE_PRESETS } from "@/lib/choicePresets";

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

/** An item's own statement text, with a shared matrix stem (already shown once above it) stripped off. */
export function itemStatement(text: string | null, stemText: string | null): string | null {
  if (!text) return null;
  if (stemText && text.startsWith(`${stemText} - `)) return text.slice(stemText.length + 3);
  return text;
}

/** Bare Qualtrics-style question tag, e.g. "Q5", "Q12a" — a suggested scale name that's just the tag. */
const TAG_NAME_RE = /^[A-Za-z]{1,6}\d+[A-Za-z]?$/;

/** Lead-in phrasing that makes a stem read as an instruction rather than a name, e.g. "Please rate...". */
const REQUEST_PHRASE_RE = /^(please|rate|indicate|how much|how often|how satisfied|to what extent|select|choose|think about|for each)\b/i;

/** A matrix stem is only usable as a scale name when it's short and doesn't read as an instruction. */
export function isNameableStem(stemText: string | null): boolean {
  if (!stemText) return false;
  return stemText.length <= 40 && !REQUEST_PHRASE_RE.test(stemText.trim());
}

/** Explicit reverse-wording markers in question text, e.g. "(reverse-worded)", "(reversed)", "(R)". No sentiment guessing. */
const REVERSE_MARKER_RE = /\((?:reverse-worded|reversed|r)\)/i;
export function hasReverseMarker(text: string | null): boolean {
  return !!text && REVERSE_MARKER_RE.test(text);
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
  /** Number of rows giving each answer, keyed by String(answer).trim(). */
  counts?: Record<string, number>;
}

const DISTINCT_CAP = 60;

export function columnStats(columns: string[], rows: CellValue[][], missingCodes: Record<string, (number | string)[]> = {}): Record<string, ColumnStats> {
  const out: Record<string, ColumnStats> = {};
  columns.forEach((c, j) => {
    const codes = new Set((missingCodes[c] ?? []).map(String));
    const seen = new Map<string, string | number | boolean>();
    const counts: Record<string, number> = {};
    let nonBlank = 0;
    for (const r of rows) {
      const x = r[j];
      if (x === null || x === "" || codes.has(String(x))) continue;
      nonBlank++;
      const k = String(x).trim();
      if (!seen.has(k)) seen.set(k, typeof x === "string" ? x.trim() : x);
      if (seen.size <= DISTINCT_CAP) counts[k] = (counts[k] ?? 0) + 1;
    }
    out[c] = { distinct: [...seen.values()].slice(0, DISTINCT_CAP), nDistinct: seen.size, nNonBlank: nonBlank, nRows: rows.length, counts };
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
  {
    value: "multi_select",
    title: "Multiple answers (select all that apply)",
    description: "People could tick more than one answer. Statly keeps one yes/no column per option so you can count and compare each one.",
  },
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
  if (unit.kind === "multiselect") {
    const children = vars.slice(1);
    if (children.length && children.every((v) => v.role !== "unassigned")) return children[0].role;
    return "multi_select";
  }
  if (vars.every((v) => v.role !== "unassigned")) {
    const r = first.role;
    return r === "scale_score" ? "ignore" : r;
  }
  if (unit.kind === "matrix") return "likert_item";
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
    case "multi_select":
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
  /** Shown as the input's placeholder and used as the name when `name` is left blank; null = no fallback (name is required). */
  placeholderName: string | null;
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
  /**
   * Knowledge questions step: a candidate item is ticked when its unit's role is test_item and it
   * isn't listed here (lets one part of a Qn_k family be left out).
   */
  knowledgeOff: Record<string, boolean>;
  /** unit id -> role/level before the knowledge step made it a test question (restored on untick). */
  roleBefore: Record<string, { role: VariableRole; level: MeasurementLevel }>;
}

export type StepId = string; // "intro" | "role:<unit>" | "level:<unit>" | "knowledge" | "labels:<unit>" | "answer_key" | "scales" | "scoring" | "summary"

const NO_LEVEL_QUESTION: VariableRole[] = ["identifier", "open_text", "ignore", "time", "test_item", "multi_select"];
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

/**
 * Raw-choice test questions (need an answer key) and already-scored numeric ones. Knowledge
 * questions (`knowledge`: candidate names) are always raw, whatever their storage type; candidates
 * left unticked inside a test-question family are neither.
 */
export function testItems(units: Unit[], draft: Draft, byName: Map<string, VariableSchema>, knowledge: Set<string> = new Set()) {
  const names = units
    .filter((u) => draft.answers[u.id]?.role === "test_item")
    .flatMap((u) => u.names)
    .filter((n) => !(knowledge.has(n) && draft.knowledgeOff?.[n]));
  const raw = (n: string) => byName.get(n)?.dtype === "string" || knowledge.has(n) || (draft.key[n]?.length ?? 0) > 0;
  return { raw: names.filter(raw), scored: names.filter((n) => !raw(n)) };
}

// --- knowledge questions ------------------------------------------------------------------

/** What a survey file says about a column (from survey.suggest): its kind and choices. */
export interface SurveyChoiceInfo {
  /** Survey question kind; "single" = single-answer multiple choice. null = unknown. */
  kind: string | null;
  choices: ValueLabel[];
  /** Codes of the choice(s) the survey's scoring marks correct. */
  correct: (number | string)[];
}

export interface KnowledgeChoice {
  /** The answer as stored in the data (what the key holds). */
  value: string;
  /** Answer-choice wording when it differs from the stored value. */
  label: string | null;
  /** The survey's code for this choice, when known. */
  code: string | null;
  count: number;
}

export interface KnowledgeCandidate {
  name: string;
  unitId: string;
  questionText: string | null;
  choices: KnowledgeChoice[];
  /** From the survey file's scoring: the correct choice's stored value. */
  surveyCorrect: string[];
}

/** Roles that rule a column out as a multiple-choice knowledge question. */
const NOT_KNOWLEDGE: VariableRole[] = ["identifier", "time", "open_text", "likert_item", "test_total", "scale_score", "ignore"];
const MAX_CHOICES = 8;
const MAX_CHOICE_LENGTH = 60;
const RATING_WORDS = new Set(CHOICE_PRESETS.flatMap((p) => Object.values(p.lengths).flat()).map((x) => x.toLowerCase()));

const fold = (x: unknown) => String(x).trim().toLowerCase();
const sameValue = (a: unknown, b: unknown) => {
  const na = Number(a), nb = Number(b);
  if (String(a).trim() !== "" && String(b).trim() !== "" && Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return fold(a) === fold(b);
};

/** The answers offered for a candidate: survey/value-label choices mapped onto the stored answers, then any other observed answer. */
function knowledgeChoices(v: VariableSchema, st: ColumnStats | undefined, survey: SurveyChoiceInfo | undefined): KnowledgeChoice[] {
  const observed = (st?.distinct ?? []).filter((d) => typeof d !== "boolean").map(String);
  const count = (x: string) => st?.counts?.[x] ?? 0;
  const labelled = survey?.choices.length ? survey.choices : v.value_labels;
  const out: KnowledgeChoice[] = [];
  const used = new Set<string>();
  for (const c of labelled) {
    const code = String(c.value);
    const hit = observed.find((o) => !used.has(o) && sameValue(o, code)) ?? observed.find((o) => !used.has(o) && fold(o) === fold(c.label));
    const value = hit ?? (v.dtype === "string" ? c.label : code);
    if (used.has(value)) continue;
    used.add(value);
    out.push({ value, label: c.label && fold(c.label) !== fold(value) ? c.label : null, code, count: hit ? count(hit) : 0 });
  }
  const rest = observed.filter((o) => !used.has(o));
  const numeric = rest.every((o) => Number.isFinite(Number(o)));
  rest.sort((a, b) => (numeric ? Number(a) - Number(b) : a.localeCompare(b)));
  for (const o of rest) out.push({ value: o, label: null, code: null, count: count(o) });
  return out;
}

/**
 * Columns that look like multiple-choice questions: a single-answer multiple-choice question in
 * the survey file, or (without one) a column with 2-8 different short answers that isn't an ID, a
 * rating/Likert question, a score, text or already scored 0/1. Likert matrices never qualify.
 */
export function knowledgeCandidates(
  units: Unit[],
  draft: Draft,
  byName: Map<string, VariableSchema>,
  stats: Record<string, ColumnStats>,
  survey: Record<string, SurveyChoiceInfo> = {},
): KnowledgeCandidate[] {
  const out: KnowledgeCandidate[] = [];
  for (const u of units) {
    if (u.kind !== "single" && u.kind !== "group") continue;
    const role = draft.answers[u.id]?.role;
    if (!role || NOT_KNOWLEDGE.includes(role)) continue;
    for (const name of u.names) {
      const v = byName.get(name);
      if (!v || v.computed || /_TEXT$/i.test(name) || /^SC\d+$/i.test(name)) continue;
      const st = stats[name];
      const sv = survey[name];
      if (sv?.kind && sv.kind !== "single") continue;
      const graded = (sv?.correct.length ?? 0) > 0;
      if (v.level === "ordinal" && !graded) continue;
      const distinct = (st?.distinct ?? []).map(String);
      if (sv?.kind !== "single") {
        if (distinct.length < 2 || (st?.nDistinct ?? 0) > MAX_CHOICES) continue;
        if (distinct.some((d) => d.length > MAX_CHOICE_LENGTH)) continue;
        if (distinct.every((d) => RATING_WORDS.has(d.toLowerCase()))) continue;
        if (v.dtype === "boolean" || v.dtype === "float") continue;
        if (v.dtype === "integer" && distinct.every((d) => d === "0" || d === "1")) continue;
      } else if (!distinct.length && !sv.choices.length) continue;
      const choices = knowledgeChoices(v, st, sv);
      const surveyCorrect = graded
        ? sv!.correct.map((c) => choices.find((ch) => ch.code !== null && sameValue(ch.code, c))?.value ?? String(c))
        : [];
      out.push({ name, unitId: u.id, questionText: v.question_text ?? v.label, choices, surveyCorrect });
    }
  }
  return out;
}

/** True when the candidate is ticked as a knowledge question. */
export function isKnowledge(draft: Draft, c: { name: string; unitId: string }): boolean {
  return draft.answers[c.unitId]?.role === "test_item" && !draft.knowledgeOff?.[c.name];
}

/**
 * Tick / untick one candidate. Ticking makes its question a test question (other parts of the
 * same family stay unticked when the family wasn't one already); unticking the last ticked part
 * gives the question back the role it had (else "Background / demographic").
 */
export function setKnowledge(draft: Draft, units: Unit[], c: { name: string; unitId: string }, on: boolean): Draft {
  const unit = units.find((u) => u.id === c.unitId);
  const a = draft.answers[c.unitId];
  if (!unit || !a) return draft;
  const answers = { ...draft.answers };
  const off = { ...draft.knowledgeOff };
  const before = { ...draft.roleBefore };
  const key = { ...draft.key };
  if (on) {
    if (a.role !== "test_item") {
      before[c.unitId] = { role: a.role, level: a.level };
      answers[c.unitId] = { ...a, role: "test_item", level: "nominal" };
      for (const n of unit.names) if (n !== c.name) off[n] = true;
    }
    delete off[c.name];
  } else {
    off[c.name] = true;
    delete key[c.name];
    if (unit.names.every((n) => off[n])) {
      const prev = before[c.unitId] ?? { role: "demographic" as VariableRole, level: "nominal" as MeasurementLevel };
      answers[c.unitId] = { ...a, role: prev.role, level: prev.level };
      delete before[c.unitId];
      for (const n of unit.names) delete off[n];
    }
  }
  return { ...draft, answers, knowledgeOff: off, roleBefore: before, key };
}

export interface ResolvedKey {
  /** item -> correct stored value(s), for candidates the file matched. */
  key: Record<string, string[]>;
  /** Questions in the file that aren't multiple-choice questions here. */
  unknownQuestions: string[];
  /** Answers in the file that match none of the question's choices. */
  unknownAnswers: { item: string; answer: string }[];
}

/** Match a loaded answer key to the candidates: questions by name, answers by wording (any case) or code. */
export function resolveKeyFile(entries: AnswerKeyEntry[], candidates: KnowledgeCandidate[]): ResolvedKey {
  const out: ResolvedKey = { key: {}, unknownQuestions: [], unknownAnswers: [] };
  for (const e of entries) {
    const c = candidates.find((x) => x.name === e.item) ?? candidates.find((x) => fold(x.name) === fold(e.item));
    if (!c) {
      out.unknownQuestions.push(e.item);
      continue;
    }
    const got: string[] = [];
    for (const ans of e.correct ?? []) {
      const hit =
        c.choices.find((ch) => fold(ch.value) === fold(ans)) ??
        c.choices.find((ch) => ch.label !== null && fold(ch.label) === fold(ans)) ??
        c.choices.find((ch) => (ch.code !== null && sameValue(ch.code, ans)) || sameValue(ch.value, ans));
      if (hit) got.push(hit.value);
      else out.unknownAnswers.push({ item: c.name, answer: String(ans) });
    }
    if (got.length) out.key[c.name] = [...new Set(got)];
  }
  return out;
}

export function likertItems(units: Unit[], draft: Draft, byName: Map<string, VariableSchema>): string[] {
  return units
    .filter((u) => draft.answers[u.id]?.role === "likert_item")
    .flatMap((u) => u.names)
    .filter((n) => ["integer", "float", "boolean"].includes(byName.get(n)?.dtype ?? ""));
}

/** The dynamic list of steps: later questions depend on earlier answers. */
export function interviewSteps(
  units: Unit[],
  draft: Draft,
  byName: Map<string, VariableSchema>,
  labelsFor: (u: Unit) => ValueLabel[] | null,
  candidates: KnowledgeCandidate[] = [],
): StepId[] {
  const steps: StepId[] = ["intro"];
  for (const u of units) steps.push(`role:${u.id}`);
  for (const u of units) {
    const a = draft.answers[u.id];
    if (a && needsLevel(a)) steps.push(`level:${u.id}`);
  }
  if (candidates.length) steps.push("knowledge");
  for (const u of units) {
    const a = draft.answers[u.id];
    if (a && hasLabelsStep(a, a.valueLabels ?? labelsFor(u))) steps.push(`labels:${u.id}`);
  }
  const cand = new Set(candidates.map((c) => c.name));
  const t = testItems(units, draft, byName, cand);
  // The knowledge step already asked about its questions: this step only covers the rest.
  if (t.raw.some((n) => !cand.has(n)) || t.scored.length) steps.push("answer_key");
  if (likertItems(units, draft, byName).length >= 2) steps.push("scales");
  if (activeScales(draft, units, byName).length) steps.push("scoring");
  steps.push("summary");
  return steps;
}

/** Scales that will be scored: items restricted to current Likert items, at least two left. */
export function activeScales(draft: Draft, units: Unit[], byName: Map<string, VariableSchema>): DraftScale[] {
  const likert = new Set(likertItems(units, draft, byName));
  return draft.scales
    .map((s) => ({ ...s, items: s.items.filter((i) => likert.has(i)) }))
    .filter((s) => s.items.length >= 2 && (s.name.trim() || s.placeholderName))
    .map((s) => (s.name.trim() ? s : { ...s, name: s.placeholderName! }));
}

export function defaultMinItems(nItems: number, method: "mean" | "sum"): number {
  return method === "mean" ? Math.max(1, Math.ceil(nItems / 2)) : Math.max(1, nItems);
}

const SCORING_EXAMPLE_BASE = [4, 5, 3, 2, 5, 4];

/** A worked example score for the Scale scores step, padded/trimmed (cyclically) to the scale's item count. */
export function scoringExample(nItems: number): { values: number[]; sum: number; average: number } {
  const n = Math.max(1, nItems);
  const values = Array.from({ length: n }, (_, i) => SCORING_EXAMPLE_BASE[i % SCORING_EXAMPLE_BASE.length]);
  const sum = values.reduce((a, b) => a + b, 0);
  return { values, sum, average: Math.round((sum / n) * 10) / 10 };
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

/** Value labels for a select-all-that-apply option column: 0 = No, 1 = Yes. */
export const MULTISELECT_YES_NO_LABELS: ValueLabel[] = [{ value: 0, label: "No" }, { value: 1, label: "Yes" }];

/** Turn the draft into engine calls, sending only what changed. */
export function buildPlan(
  meta: DatasetMeta,
  units: Unit[],
  draft: Draft,
  labelsFor: (u: Unit) => ValueLabel[] | null,
  knowledge: Set<string> = new Set(),
): InterviewPlan {
  const byName = new Map(meta.variables.map((v) => [v.name, v]));
  const likert = new Set(likertItems(units, draft, byName));
  const updates: VariablePatch[] = [];
  for (const u of units) {
    const a = draft.answers[u.id];
    if (!a) continue;
    const labels = hasLabelsStep(a, a.valueLabels ?? labelsFor(u)) ? (a.valueLabels ?? labelsFor(u)) : null;
    const parentName = u.kind === "multiselect" && a.role === "multi_select" ? u.names[0] : null;
    for (const name of u.names) {
      const v = byName.get(name);
      if (!v) continue;
      const isParent = name === parentName;
      const role = isParent ? "open_text" : a.role;
      const varLabels = isParent ? labels : a.role === "multi_select" ? MULTISELECT_YES_NO_LABELS : labels;
      const p: VariablePatch = { name };
      if (v.role !== role) p.role = role;
      if (v.level !== a.level) p.level = a.level;
      if (varLabels && !sameLabels(v.value_labels, varLabels)) p.value_labels = varLabels;
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
  // Knowledge questions are scored whenever they have an answer; the answer-key step's choice
  // (key / scored / skip) covers the other test questions.
  const t = testItems(units, draft, byName, knowledge);
  const entries = t.raw
    .filter((n) => (knowledge.has(n) || draft.keyMode === "key") && (draft.key[n] ?? []).length)
    .map((n) => ({ item: n, correct: draft.key[n] as (number | string)[] | null }));
  const addScored = (draft.keyMode === "key" && entries.length > 0) || (draft.keyMode === "scored" && t.scored.length >= 2);
  const all = [...entries, ...(addScored ? t.scored.map((n) => ({ item: n, correct: null })) : [])];
  const key: AnswerKeyEntry[] | null = all.length ? all : null;
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
  for (const v of meta.variables) {
    if (v.reverse_coded || hasReverseMarker(v.question_text) || hasReverseMarker(v.label)) reverse[v.name] = true;
  }
  const scales: DraftScale[] = meta.scales.map((s) => {
    const isAutoTag = s.origin === "matrix_suggestion" && TAG_NAME_RE.test(s.name.trim());
    const unit = isAutoTag ? units.find((u) => u.id === `scale:${s.id}`) : undefined;
    const stemText = unit?.questionText?.trim() || null;
    return {
      key: s.id,
      id: s.id,
      name: isAutoTag ? (isNameableStem(stemText) ? stemText! : "") : s.name,
      placeholderName: isAutoTag ? s.name : null,
      items: [...s.items],
      method: s.scoring_method,
      minItems: s.min_items,
    };
  });
  return { answers, reverse, scales, keyMode: "key", key: {}, knowledgeOff: {}, roleBefore: {} };
}

/** Plain-language checks that block moving on from a step (null = OK). */
export function stepProblem(
  step: StepId,
  draft: Draft,
  units: Unit[],
  byName: Map<string, VariableSchema>,
  knowledge: Set<string> = new Set(),
): string | null {
  if (step === "answer_key" && draft.keyMode === "key") {
    const raw = testItems(units, draft, byName, knowledge).raw.filter((n) => !knowledge.has(n));
    if (raw.length && !raw.some((n) => (draft.key[n] ?? []).length)) {
      return "Enter at least one correct answer, load an answer key, or choose to skip scoring for now.";
    }
  }
  if (step === "scales") {
    // An empty name falls back to the suggested tag on save, so it never blocks Continue.
    const names = draft.scales.filter((s) => s.items.length).map((s) => (s.name.trim() || s.placeholderName || "").trim().toLowerCase());
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
