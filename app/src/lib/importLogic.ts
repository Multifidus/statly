/**
 * Pure helpers for the import wizard: grouping response sets, spotting non-contiguous codes,
 * default time labels, and turning the user's decisions into DatasetImportParams.
 * Kept free of React/zustand so they are unit-testable.
 */
import type {
  ColumnMatch,
  DatasetImportParams,
  DatasetImportPreviewResult,
  FilePreview,
  IdNormalization,
  LinkMode,
  RowFilter,
  StackConfig,
  ValueLabel,
  VariableSchema,
} from "@/contracts";

export interface ResponseSet {
  /** Stable key: the matrix (scale) the items belong to, plus the sorted label list. */
  key: string;
  variables: string[];
  /** Labels in the engine's proposed order. */
  labels: string[];
}

export interface NoncontiguousVar {
  variable: string;
  codes: number[];
}

export type MatchDecision = "accept" | "separate";

/** What the user decided in the wizard (everything except the preview itself). */
export interface ImportDecisions {
  /** file_id -> use Qualtrics header rows (true) or treat row 1 as the only header (false). */
  qualtricsConfirmed: Record<string, boolean>;
  sheetByFile: Record<string, string | null>;
  hideMetadata: boolean;
  /** Variable names to drop at import (applied to every file that has them). */
  dropColumns: string[];
  /** Suggested filter id -> enabled. */
  enabledFilters: Record<string, boolean>;
  /** Remove rows with Progress below this (null = off). */
  progressThreshold: number | null;
  /** Multi-select column -> split into yes/no indicator variables at import. */
  multiselectSplit: Record<string, boolean>;
  /** Response-set key -> confirmed label order (lowest to highest). */
  responseOrder: Record<string, string[]>;
  /** Response-set key -> numeric code per position in `responseOrder` (default 1..k). */
  responseCodes: Record<string, number[]>;
  responseConfirmed: Record<string, boolean>;
  noncontiguousAck: Record<string, boolean>;
  timeVariable: string;
  timeLabels: Record<string, string>;
  levelOrder: string[];
  matchDecisions: Record<string, MatchDecision>;
  linkMode: LinkMode;
  idVariable: string | null;
  normalization: IdNormalization;
}

/** All proposed variables across files, first occurrence of each name wins. */
export function unionVariables(files: FilePreview[]): VariableSchema[] {
  const seen = new Map<string, VariableSchema>();
  for (const f of files) for (const v of f.proposed_variables) if (!seen.has(v.name)) seen.set(v.name, v);
  return [...seen.values()];
}

/**
 * Is this a question exported as answer text? The engine proposes such columns as integer
 * variables whose value_labels map the text to codes 1..k and flags them with a
 * `choice_text_detected` issue; string-valued labels are accepted too.
 */
function isChoiceText(v: VariableSchema, flagged: Set<string>): boolean {
  if (v.value_labels.length < 2) return false;
  if (v.role !== "likert_item" && v.level !== "ordinal") return false;
  if (flagged.has(v.name)) return true;
  return v.value_labels.every((l) => typeof l.value === "string");
}

/**
 * Text-choice variables grouped into response sets: items of one matrix (same scale_id) share
 * a set; standalone questions are grouped by identical label sets. Keeping a matrix apart from a
 * standalone question with the same wording lets each get its own codes.
 */
export function findResponseSets(files: FilePreview[]): ResponseSet[] {
  const flagged = new Set(
    files.flatMap((f) => f.issues.filter((i) => i.code === "choice_text_detected" && i.column).map((i) => i.column as string)),
  );
  const groups = new Map<string, ResponseSet>();
  for (const v of unionVariables(files)) {
    if (!isChoiceText(v, flagged)) continue;
    const labels = v.value_labels.map((l) => l.label);
    const key = `${v.scale_id ?? ""}\u0002${[...labels].sort().join("\u0001")}`;
    const g = groups.get(key);
    if (g) g.variables.push(v.name);
    else groups.set(key, { key, variables: [v.name], labels });
  }
  return [...groups.values()];
}

/** Default codes 1..k for a response set of k choices. */
export const defaultCodes = (k: number): number[] => Array.from({ length: k }, (_, i) => i + 1);

/** Codes for a set: the user's, if they cover every choice, else 1..k. */
export function codesFor(d: ImportDecisions, key: string, k: number): number[] {
  const c = d.responseCodes?.[key];
  return c && c.length === k ? c : defaultCodes(k);
}

/** Plain-language problem with a code list, or null when every code is a distinct whole number. */
export function codesProblem(codes: number[]): string | null {
  if (codes.some((c) => !Number.isInteger(c))) return "Each answer code must be a whole number.";
  if (new Set(codes).size !== codes.length) return "Each answer choice needs a different code.";
  return null;
}

/** Numeric-coded variables whose codes skip values (e.g. Qualtrics recodes 1, 2, 4, 5, 7). */
export function findNoncontiguous(files: FilePreview[]): NoncontiguousVar[] {
  const out: NoncontiguousVar[] = [];
  for (const v of unionVariables(files)) {
    const codes = v.value_labels.map((l) => l.value).filter((x): x is number => typeof x === "number");
    if (codes.length < 2 || codes.length !== v.value_labels.length) continue;
    const sorted = [...codes].sort((a, b) => a - b);
    if (sorted.some((c, i) => i > 0 && c !== sorted[i - 1] + 1)) out.push({ variable: v.name, codes: sorted });
  }
  return out;
}

const KNOWN_ORDERS: string[][] = [
  ["strongly disagree", "disagree", "somewhat disagree", "neither agree nor disagree", "neutral", "somewhat agree", "agree", "strongly agree"],
  ["very dissatisfied", "dissatisfied", "somewhat dissatisfied", "neutral", "somewhat satisfied", "satisfied", "very satisfied"],
  ["never", "rarely", "sometimes", "often", "usually", "always"],
  ["not at all", "slightly", "somewhat", "moderately", "very", "extremely"],
  ["very poor", "poor", "fair", "good", "very good", "excellent"],
];

/** Best-guess low-to-high order for common response scales; engine order otherwise. */
export function suggestOrder(labels: string[]): string[] {
  const lower = labels.map((l) => l.trim().toLowerCase());
  for (const scale of KNOWN_ORDERS) {
    if (lower.every((l) => scale.includes(l))) {
      return [...labels].sort((a, b) => scale.indexOf(a.trim().toLowerCase()) - scale.indexOf(b.trim().toLowerCase()));
    }
  }
  return labels;
}

/** "pre.csv" -> "Pre", "followup.csv" -> "Follow-up"; falls back to "Time N". */
export function defaultTimeLabel(fileName: string, index: number): string {
  const n = fileName.toLowerCase().replace(/\.[a-z0-9]+$/, "");
  if (/follow[\s_-]?up/.test(n)) return "Follow-up";
  if (/(^|[^a-z])post/.test(n)) return "Post";
  if (/(^|[^a-z])pre(?!view)/.test(n)) return "Pre";
  return `Time ${index + 1}`;
}

export function defaultDecisions(preview: DatasetImportPreviewResult): ImportDecisions {
  const files = preview.files;
  const enabledFilters: Record<string, boolean> = {};
  for (const f of files) {
    for (const flt of f.suggested_row_filters) enabledFilters[flt.id] = flt.kind === "exclude_values";
  }
  const responseOrder: Record<string, string[]> = {};
  for (const s of findResponseSets(files)) responseOrder[s.key] = suggestOrder(s.labels);
  const matchDecisions: Record<string, MatchDecision> = {};
  return {
    qualtricsConfirmed: Object.fromEntries(files.map((f) => [f.file_id, f.qualtrics.detected])),
    sheetByFile: Object.fromEntries(files.map((f) => [f.file_id, f.sheet_name])),
    hideMetadata: true,
    dropColumns: unionVariables(files).filter((v) => v.is_pii).map((v) => v.name),
    enabledFilters,
    progressThreshold: null,
    multiselectSplit: Object.fromEntries(files.flatMap((f) => f.multiselect_candidates).map((c) => [c, true])),
    responseOrder,
    responseCodes: {},
    responseConfirmed: {},
    noncontiguousAck: {},
    timeVariable: "Time",
    timeLabels: Object.fromEntries(files.map((f, i) => [f.file_id, defaultTimeLabel(f.name, i)])),
    levelOrder: files.map((f) => f.file_id),
    matchDecisions,
    linkMode: "aggregate",
    idVariable: null,
    normalization: { trim_whitespace: true, case_insensitive: true },
  };
}

/** Why the user can't leave a step yet (plain language), or null when they can. */
export function blockingReason(
  step: "files" | "detect" | "cleanup" | "stack" | "link" | "summary",
  preview: DatasetImportPreviewResult | null,
  d: ImportDecisions | null,
  fileCount: number,
): string | null {
  if (step === "files") return fileCount ? null : "Choose at least one file to continue.";
  if (!preview || !d) return "Statly is still reading your files.";
  if (step === "cleanup") {
    const sets = findResponseSets(preview.files);
    if (sets.some((s) => !d.responseConfirmed[s.key])) return "Confirm the order of each set of answer choices.";
    if (sets.some((s) => codesProblem(codesFor(d, s.key, s.labels.length)))) {
      return "Give each answer choice a different whole-number code.";
    }
    const nc = findNoncontiguous(preview.files);
    if (nc.some((v) => !d.noncontiguousAck[v.variable])) return "Confirm the unusual answer codes.";
    if (d.progressThreshold !== null && !(d.progressThreshold > 0 && d.progressThreshold <= 100)) {
      return "Enter a progress cutoff between 1 and 100.";
    }
  }
  if (step === "stack") {
    const labels = d.levelOrder.map((id) => (d.timeLabels[id] ?? "").trim());
    if (labels.some((l) => !l)) return "Give every file a time label.";
    if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) return "Each time label must be different.";
    if (!d.timeVariable.trim()) return "Name the time variable.";
    const pending = (preview.stack_proposal ?? []).filter((m) => m.status === "possibly_renamed" && !d.matchDecisions[m.variable]);
    if (pending.length) return `Decide on ${pending.length} possibly renamed question${pending.length > 1 ? "s" : ""}.`;
  }
  if (step === "link" && d.linkMode === "linked") {
    if (!d.idVariable) return "Pick the variable that identifies each person.";
    if (d.dropColumns.includes(d.idVariable)) return "The ID variable is set to be removed. Keep it in the clean-up step, or pick another.";
  }
  return null;
}

/** Final column matches after the user's accept / keep-separate choices. */
export function resolveMatches(proposal: ColumnMatch[], decisions: Record<string, MatchDecision>): ColumnMatch[] {
  const out: ColumnMatch[] = [];
  const taken = new Set(proposal.filter((m) => m.status !== "possibly_renamed").map((m) => m.variable));
  for (const m of proposal) {
    if (m.status !== "possibly_renamed") {
      out.push(m);
      continue;
    }
    if (decisions[m.variable] !== "separate") {
      out.push({ ...m, status: "matched" });
      taken.add(m.variable);
      continue;
    }
    // Keep separate: columns that share a short name still belong together; only the
    // differently named (renamed) column(s) are split off into their own variables.
    const byColumn = new Map<string, ColumnMatch["columns"]>();
    for (const c of m.columns) byColumn.set(c.column, [...(byColumn.get(c.column) ?? []), c]);
    for (const [column, cols] of byColumn) {
      let name = column;
      let k = 2;
      while (taken.has(name)) name = `${column}_${k++}`;
      taken.add(name);
      out.push({ variable: name, status: "unmatched", similarity: null, columns: cols });
    }
  }
  return out;
}

function codedLabels(order: string[], codes: number[]): ValueLabel[] {
  return order.map((label, i) => ({ value: codes[i], label }));
}

/** Engine-compatible slug (statly_engine.data.columns.slug). */
function slug(text: string): string {
  return text.replace(/[^0-9A-Za-z]+/g, "_").replace(/^_+|_+$/g, "") || "option";
}

/**
 * One yes/no indicator variable per option of a multi-select column. The engine recognizes
 * them by `sources[0]` pointing at the multi-select column and `label` = the option text
 * (docs/PROTOCOL.md "Multi-select split"). Mirrors importer.multiselect_indicator_variables.
 */
export function multiselectIndicators(v: VariableSchema, taken: Set<string>): VariableSchema[] {
  return v.value_labels.map((vl, k) => {
    const option = String(vl.label);
    const base = `${v.name}_${slug(option)}`;
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
    taken.add(name);
    return {
      ...v,
      name,
      label: option,
      question_text: `${v.question_text ?? v.name} - ${option}`,
      role: "unassigned",
      level: "nominal",
      dtype: "integer",
      value_labels: [
        { value: 0, label: "Not selected" },
        { value: 1, label: "Selected" },
      ],
      reverse_coded: false,
      response_range: null,
      scale_id: null,
      missing_codes: [],
      is_pii: false,
      pii_reason: null,
      computed: null,
      sources: v.sources.slice(0, 1),
      display_order: v.display_order + 1 + k,
    };
  });
}

/** Turn preview + decisions into the `dataset.import` params. */
export function buildImportParams(preview: DatasetImportPreviewResult, d: ImportDecisions): DatasetImportParams {
  const files = preview.files;
  const multi = files.length > 1;

  const row_filters: RowFilter[] = files.flatMap((f) => f.suggested_row_filters.filter((flt) => d.enabledFilters[flt.id]));
  if (d.progressThreshold !== null) {
    row_filters.push({
      id: "user_progress_below",
      kind: "progress_below",
      file_id: null,
      variable: "Progress",
      values: null,
      threshold: d.progressThreshold,
      explanation: `Removes responses where the person got through less than ${d.progressThreshold}% of the survey.`,
      rows_removed: 0,
    });
  }

  // Variables: only the ones the user changed. Unmentioned columns keep the engine's proposal,
  // which matters when stacking widened a type (e.g. integer in one file, decimal in another).
  const kept = unionVariables(files).filter((v) => !d.dropColumns.includes(v.name));
  const variables: VariableSchema[] = [];
  for (const s of findResponseSets(files)) {
    const order = d.responseOrder[s.key] ?? s.labels;
    const codes = codesFor(d, s.key, order.length);
    for (const v of kept.filter((x) => s.variables.includes(x.name))) {
      variables.push({
        ...v,
        dtype: "integer",
        missing_codes: v.missing_codes.map((c) => (typeof c === "string" && c.trim() !== "" && Number.isFinite(Number(c)) ? Number(c) : c)),
        value_labels: codedLabels(order, codes),
        response_range: { min: Math.min(...codes), max: Math.max(...codes) },
      });
    }
  }
  const taken = new Set([
    ...unionVariables(files).map((v) => v.name),
    ...(preview.stack_proposal ?? []).map((m) => m.variable),
    ...(multi ? [d.timeVariable.trim()] : []),
  ]);
  for (const v of kept) {
    if (!d.multiselectSplit[v.name] || !files.some((f) => f.multiselect_candidates.includes(v.name))) continue;
    variables.push(...multiselectIndicators(v, taken));
  }

  const decisionsFiles = files.map((f) => ({
    file_id: f.file_id,
    sheet_name: d.sheetByFile[f.file_id] ?? f.sheet_name,
    encoding: f.encoding,
    delimiter: f.delimiter,
    qualtrics_header_rows: d.qualtricsConfirmed[f.file_id] ? f.qualtrics.header_rows : 1,
    time_label: multi ? (d.timeLabels[f.file_id] ?? "").trim() : null,
    drop_columns: f.proposed_variables.filter((v) => d.dropColumns.includes(v.name)).map((v) => v.name),
  }));

  let stack: StackConfig | null = null;
  if (multi) {
    stack = {
      time_variable: d.timeVariable.trim(),
      levels: d.levelOrder.map((file_id) => ({ file_id, label: (d.timeLabels[file_id] ?? "").trim() })),
      column_matches: resolveMatches(preview.stack_proposal ?? [], d.matchDecisions),
    };
  }

  return {
    preview_id: preview.preview_id,
    files: decisionsFiles as DatasetImportParams["files"],
    row_filters,
    variables,
    stack,
  };
}
