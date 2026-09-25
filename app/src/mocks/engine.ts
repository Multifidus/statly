/**
 * In-browser MockEngine implementing the Phase 1 RPC methods (contracts/README.md) over
 * synthetic practice-dataset shapes (./shapes.ts) and contracts/examples/ProjectFile.json.
 * Selected with VITE_STATLY_MOCK=1 (see lib/engineMode.ts). Dev/test only: never bundled
 * into production builds because every import of this module sits behind that flag.
 */
import exampleProject from "../../../contracts/examples/ProjectFile.json";
import type {
  CellValue,
  ColumnMatch,
  ComputedDefinition,
  ComputedRecode,
  DatasetIdParams,
  DatasetImportParams,
  DatasetImportPreviewParams,
  DatasetImportPreviewResult,
  DatasetLinkParams,
  DatasetLinkResult,
  DatasetMeta,
  DatasetMissingSummaryResult,
  DatasetResult,
  DatasetRowsParams,
  DatasetRowsResult,
  DatasetStackParams,
  FilePreview,
  ImportFileDecision,
  ImportIssue,
  ImportedFile,
  LinkCounts,
  OkResult,
  ProjectAutosaveParams,
  ProjectAutosaveResult,
  ProjectDiscardAutosaveParams,
  ProjectFile,
  ProjectLoadParams,
  ProjectLoadResult,
  ProjectRecoverableParams,
  ProjectRecoverableResult,
  ProjectSaveParams,
  ProjectSaveResult,
  RecodeRule,
  RowFilter,
  Scale,
  StackConfig,
  StorageDtype,
  VariableMissingSummary,
  VariableOperand,
  VariableRole,
  VariableSchema,
} from "@/contracts";
import type { EngineError } from "@/lib/engine";
import type { Transport } from "@/lib/rpc";
import type {
  AnswerKeyEntry,
  ComputedAddParams,
  ComputedPreviewParams,
  ComputedPreviewResult,
  ComputedRemoveParams,
  DatasetEditResult,
  EditWarning,
  HistoryResult,
  ItemsScoreParams,
  RestoreSnapshotResult,
  ScalesDeleteParams,
  ScalesUpsertParams,
  VariablePatch,
  VariablesUpdateParams,
} from "@/lib/variablesRpc";
import { answerKeyForPath, MOCK_EXAMPLE_PROJECT_PATH, shapeForPath, type FileShape } from "./shapes";

// --- helpers -----------------------------------------------------------------------------

function hash32(...parts: number[]): number {
  let h = 2166136261;
  for (const p of parts) {
    h ^= p | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
}

function strHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

function rpcError(code: number, message: string, type: string): EngineError {
  return { kind: "rpc", code, message, data: { type } };
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const nowIso = () => new Date().toISOString();
const clone = <T,>(x: T): T => structuredClone(x);

export function makeVariable(name: string, o: Partial<VariableSchema> = {}): VariableSchema {
  return {
    schema_version: 1,
    name,
    label: null,
    question_text: null,
    role: "unassigned",
    level: "nominal",
    dtype: "string",
    value_labels: [],
    reverse_coded: false,
    response_range: null,
    scale_id: null,
    missing_codes: [],
    sources: [],
    is_metadata: false,
    is_pii: false,
    pii_reason: null,
    computed: null,
    display_order: 0,
    ...o,
  };
}

const isBlank = (v: CellValue) => v === null || v === "";
const same = (a: CellValue, b: string | number) => a !== null && String(a) === String(b);

// --- staged state ------------------------------------------------------------------------

interface StagedFile {
  preview: FilePreview;
  shape: FileShape;
  seed: number;
  /** Raw cell for (source row, column name). */
  cell: (r: number, col: string) => CellValue;
}

interface Staged {
  files: StagedFile[];
}

/** One entry in a dataset's undo/redo history; meta/computed are null once evicted (> MAX_RESTORABLE old). */
interface SnapshotEntry {
  snapshot_id: string;
  label: string;
  timestamp: string;
  meta: DatasetMeta | null;
  computed: Map<string, CellValue[]> | null;
}

interface DatasetState {
  meta: DatasetMeta;
  nRows: number;
  columns: string[];
  /** Effective cell accessor: computedCols overlay, then baseCell. */
  cell: (r: number, col: string) => CellValue;
  /** Raw imported/generated cell accessor (never includes computed variables). */
  baseCell: (r: number, col: string) => CellValue;
  /** Computed variable name -> per-row values, refreshed by recomputeAll after every edit. */
  computedCols: Map<string, CellValue[]>;
  history: SnapshotEntry[];
  cursor: number;
}

/** How many earlier files in the current preview share this path (set by previewFiles). */
let previewPaths: string[] = [];
const dupIndex = (path: string, idx: number) => previewPaths.slice(0, idx).filter((p) => p === path).length;

function stageFile(path: string, sheet: string | null, idx: number): StagedFile {
  const shape = shapeForPath(path, sheet);
  if (!shape) {
    throw rpcError(-32001, `Unsupported or unreadable file: ${baseName(path)}`, "FileUnreadable");
  }
  // Like the engine: derived from the path, so it is stable across re-previews (sheet changes).
  const fileId = `f_${(strHash(path) >>> 0).toString(36)}${idx > 0 && dupIndex(path, idx) ? `_${dupIndex(path, idx) + 1}` : ""}`;
  const seed = strHash(shape.key);
  const colIdx = new Map(shape.cols.map((c, i) => [c.name, i]));
  const cache = new Map<string, CellValue>();
  const cell = (r: number, col: string): CellValue => {
    const ci = colIdx.get(col);
    if (ci === undefined || r < 0 || r >= shape.nRows) return null;
    const key = `${r}:${ci}`;
    if (shape.nRows <= 1000 && cache.has(key)) return cache.get(key)!;
    const v = shape.cols[ci].gen(r, (salt = 0) => hash32(seed, r, ci, salt));
    if (shape.nRows <= 1000) cache.set(key, v);
    return v;
  };

  const vars = shape.cols.map((c, i) =>
    makeVariable(c.name, {
      label: c.text.length <= 40 ? c.text : null,
      question_text: shape.qualtrics ? c.text : null,
      display_order: i,
      sources: [
        {
          file_id: fileId,
          original_column_name: c.name,
          qualtrics_import_id: shape.headerRows === 3 ? `QID_${c.name}` : null,
          header_texts:
            shape.headerRows === 1 ? [c.name] : shape.headerRows === 2 ? [c.name, c.text] : [c.name, c.text, `{"ImportId":"${c.name}"}`],
        },
      ],
      ...c.var,
    }),
  );

  const has = (n: string) => colIdx.has(n);
  const count = (pred: (r: number) => boolean) => {
    let n = 0;
    for (let r = 0; r < shape.nRows; r++) if (pred(r)) n++;
    return n;
  };
  const filters: RowFilter[] = [];
  if (shape.qualtrics && has("Status")) {
    filters.push({
      id: `${fileId}_status`,
      kind: "exclude_values",
      file_id: fileId,
      variable: "Status",
      values: ["Survey Preview", "Spam"],
      threshold: null,
      explanation: "Removes test runs made with Qualtrics' Preview button and responses Qualtrics marked as spam.",
      rows_removed: count((r) => ["Survey Preview", "Spam"].includes(String(cell(r, "Status")))),
    });
  }
  if (shape.qualtrics && has("Finished")) {
    filters.push({
      id: `${fileId}_unfinished`,
      kind: "exclude_unfinished",
      file_id: fileId,
      variable: "Finished",
      values: null,
      threshold: null,
      explanation: "Removes people who started the survey but didn't finish it.",
      rows_removed: count((r) => cell(r, "Finished") === false),
    });
  }

  const issues: ImportIssue[] = [];
  if (shape.format === "xlsx" && shape.sheets.length > 1 && !sheet) {
    issues.push({
      code: "sheet_choice",
      severity: "caution",
      message: `This workbook has ${shape.sheets.length} sheets. Statly opened "${shape.sheets[0]}". Pick the sheet that holds your responses.`,
      file_id: fileId,
      column: null,
    });
  }
  for (const v of vars) {
    if (v.dtype === "integer" && v.value_labels.some((l) => typeof l.value === "number" && l.label !== String(l.value))) {
      issues.push({
        code: "choice_text_detected",
        severity: "info",
        message: `'${v.name}' contains answer text. We will store it as numbers 1-${v.value_labels.length} in that order.`,
        file_id: fileId,
        column: v.name,
      });
    }
    const codes = v.value_labels.map((l) => l.value).filter((x): x is number => typeof x === "number");
    if (codes.length > 1 && codes.some((c, i) => i > 0 && c !== codes[i - 1] + 1)) {
      issues.push({
        code: "noncontiguous_codes",
        severity: "caution",
        message: `${v.name} uses the codes ${codes.join(", ")}, not 1-${codes.length}.`,
        file_id: fileId,
        column: v.name,
      });
    }
    if (v.missing_codes.length) {
      issues.push({
        code: "missing_code_detected",
        severity: "info",
        message: `${v.name} contains ${v.missing_codes.join(", ")}, which usually means "no answer".`,
        file_id: fileId,
        column: v.name,
      });
    }
  }
  if (has("Q9") && shape.key.startsWith("messy")) {
    issues.push({
      code: "pii_lookalike",
      severity: "info",
      message: "Some answers in Q9 mention email-like text. Statly didn't flag the whole column, but skim it before sharing data.",
      file_id: fileId,
      column: "Q9",
    });
  }

  const preview: FilePreview = {
    file_id: fileId,
    path,
    name: baseName(path),
    sha256: (strHash(path) >>> 0).toString(16).padStart(64, "0"),
    size_bytes: shape.nRows * shape.cols.length * 9,
    format: shape.format,
    sheets: shape.sheets,
    sheet_name: shape.format === "xlsx" ? (sheet ?? shape.sheets[0] ?? null) : null,
    encoding: shape.encoding,
    delimiter: shape.delimiter,
    qualtrics: { detected: shape.qualtrics, confirmed: false, header_rows: shape.headerRows },
    n_rows: shape.nRows,
    proposed_variables: vars,
    sample_rows: Array.from({ length: Math.min(50, shape.nRows) }, (_, r) => shape.cols.map((c) => cell(r, c.name))),
    suggested_row_filters: filters,
    suggested_scales: shape.scales,
    multiselect_candidates: shape.multiselect,
    issues,
  };
  return { preview, shape, seed, cell };
}

function normalizeText(s: string | null): string[] {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
}

function similarity(a: string | null, b: string | null): number {
  const A = new Set(normalizeText(a));
  const B = new Set(normalizeText(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((x) => B.has(x) && inter++);
  return inter / (A.size + B.size - inter);
}

/** Match columns across files: same short ID -> matched; similar question text -> possibly renamed. */
export function proposeStack(files: FilePreview[]): ColumnMatch[] {
  const byName = new Map<string, { file_id: string; column: string; text: string | null }[]>();
  for (const f of files) {
    for (const v of f.proposed_variables) {
      const list = byName.get(v.name) ?? [];
      list.push({ file_id: f.file_id, column: v.name, text: v.question_text });
      byName.set(v.name, list);
    }
  }
  const matches: ColumnMatch[] = [];
  const consumed = new Set<string>();
  const names = [...byName.keys()];
  for (const name of names) {
    if (consumed.has(name)) continue;
    const cols = byName.get(name)!;
    if (cols.length === files.length) {
      matches.push({ variable: name, status: "matched", similarity: null, columns: cols.map(({ file_id, column }) => ({ file_id, column })) });
      consumed.add(name);
      continue;
    }
    // Look for a partner column with similar question text in the files this one misses.
    const present = new Set(cols.map((c) => c.file_id));
    let best: { name: string; sim: number } | null = null;
    for (const other of names) {
      if (other === name || consumed.has(other)) continue;
      const oc = byName.get(other)!;
      if (oc.some((c) => present.has(c.file_id))) continue;
      const sim = similarity(cols[0].text, oc[0].text);
      if (sim >= 0.6 && (!best || sim > best.sim)) best = { name: other, sim };
    }
    if (best) {
      const oc = byName.get(best.name)!;
      matches.push({
        variable: name,
        status: "possibly_renamed",
        similarity: Math.round(best.sim * 100) / 100,
        columns: [...cols, ...oc].map(({ file_id, column }) => ({ file_id, column })),
      });
      consumed.add(name);
      consumed.add(best.name);
    } else {
      matches.push({ variable: name, status: "unmatched", similarity: null, columns: cols.map(({ file_id, column }) => ({ file_id, column })) });
      consumed.add(name);
    }
  }
  return matches;
}

function passesFilters(f: StagedFile, r: number, filters: RowFilter[]): boolean {
  for (const flt of filters) {
    if (flt.file_id && flt.file_id !== f.preview.file_id) continue;
    if (flt.kind === "exclude_values" && flt.variable) {
      const v = f.cell(r, flt.variable);
      if ((flt.values ?? []).some((x) => same(v, x))) return false;
    } else if (flt.kind === "exclude_unfinished") {
      const v = f.cell(r, flt.variable ?? "Finished");
      if (v === false || v === "False" || v === 0) return false;
    } else if (flt.kind === "progress_below" && flt.threshold !== null) {
      const v = Number(f.cell(r, flt.variable ?? "Progress"));
      if (Number.isFinite(v) && v < flt.threshold) return false;
    }
  }
  return true;
}

function missingSummary(ds: { nRows: number; cell: (r: number, col: string) => CellValue }, vars: VariableSchema[]): VariableMissingSummary[] {
  return vars.map((v) => {
    let blank = 0;
    let coded = 0;
    for (let r = 0; r < ds.nRows; r++) {
      const x = ds.cell(r, v.name);
      if (isBlank(x)) blank++;
      else if (v.missing_codes.some((c) => same(x, c))) coded++;
    }
    const n = ds.nRows;
    return {
      variable: v.name,
      n_total: n,
      n_valid: n - blank - coded,
      n_missing_blank: blank,
      n_missing_coded: coded,
      pct_missing: n ? Math.round(((blank + coded) / n) * 10_000) / 100 : 0,
    };
  });
}

// --- Phase 2: variable interview (docs/PROTOCOL.md "Phase 2 methods") --------------------
//
// Ports engine/statly_engine/data/{variables,scoring}.py: pure functions over a DatasetState
// (base imported columns + a computed-column overlay), plus the DatasetStore.commit/restore
// undo-redo history from engine/statly_engine/data/store.py.

const NUMERIC_DTYPES: StorageDtype[] = ["integer", "float", "boolean"];
const MAX_RESTORABLE = 50;

function slug(text: string): string {
  const s = text.replace(/[^0-9A-Za-z]+/g, "_").replace(/^_+|_+$/g, "");
  return s || "option";
}

function fmtNum(x: number): string {
  return Number.isInteger(x) ? String(x) : String(Number(x.toPrecision(6)));
}

function dedupeWarns(warns: EditWarning[]): EditWarning[] {
  const seen = new Set<string>();
  const out: EditWarning[] = [];
  for (const w of warns) {
    const key = `${w.code}\u0000${w.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(w);
    }
  }
  return out;
}

function byNameMap(meta: DatasetMeta): Map<string, VariableSchema> {
  return new Map(meta.variables.map((v) => [v.name, v]));
}

function isValidCell(v: VariableSchema, raw: CellValue): boolean {
  return !isBlank(raw) && !v.missing_codes.some((c) => same(raw, c));
}

/** A dataset's computed-column overlay: name -> per-row values, checked before base data. */
interface CellSource {
  nRows: number;
  baseCell: (r: number, col: string) => CellValue;
  computedCols: Map<string, CellValue[]>;
}

function cellFor(ds: CellSource, col: string, r: number): CellValue {
  const c = ds.computedCols.get(col);
  if (c) return r < c.length ? c[r] : null;
  return ds.baseCell(r, col);
}

function numOrNull(v: CellValue): number | null {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function valuesSame(x: CellValue, target: CellValue): boolean {
  const nx = numOrNull(x);
  const nt = numOrNull(target);
  if (nx !== null && nt !== null) return nx === nt;
  return String(x).trim() === String(target).trim();
}

function numericColumn(ds: CellSource, v: VariableSchema, purpose: string): number[] {
  if (!NUMERIC_DTYPES.includes(v.dtype)) {
    throw rpcError(
      -32003,
      `'${v.name}' holds text, so it can't be used ${purpose}. Choose a variable with numbers, or confirm its answer codes first.`,
      "InvalidParams",
    );
  }
  const out: number[] = new Array(ds.nRows);
  for (let r = 0; r < ds.nRows; r++) {
    const raw = cellFor(ds, v.name, r);
    out[r] = isValidCell(v, raw) ? (numOrNull(raw) ?? NaN) : NaN;
  }
  return out;
}

function reverseBounds(ds: CellSource, v: VariableSchema): { lo: number; hi: number; warn: EditWarning | null } {
  if (v.response_range) return { lo: v.response_range.min, hi: v.response_range.max, warn: null };
  const x = numericColumn(ds, v, "as a scale item");
  const ok = x.filter((n) => !Number.isNaN(n));
  if (!ok.length) {
    return {
      lo: NaN,
      hi: NaN,
      warn: { code: "reverse_no_data", message: `'${v.name}' has no answers, so it could not be reverse-scored.`, variable: v.name },
    };
  }
  const lo = Math.min(...ok);
  const hi = Math.max(...ok);
  return {
    lo,
    hi,
    warn: {
      code: "reverse_range_observed",
      message:
        `'${v.name}' has no answer range set, so Statly reversed it using the lowest and highest answers people ` +
        `actually gave (${fmtNum(lo)} and ${fmtNum(hi)}). If the scale really runs wider (for example 1 to 5), set ` +
        "the answer range so reverse-scoring is exact.",
      variable: v.name,
    },
  };
}

function itemScores(ds: CellSource, v: VariableSchema): { x: number[]; warns: EditWarning[] } {
  const x = numericColumn(ds, v, "as a scale item");
  const warns: EditWarning[] = [];
  if (v.reverse_coded) {
    const { lo, hi, warn } = reverseBounds(ds, v);
    if (warn) warns.push(warn);
    for (let r = 0; r < x.length; r++) if (!Number.isNaN(x[r])) x[r] = lo + hi - x[r];
  }
  return { x, warns };
}

function defaultMinItems(nItems: number, method: "mean" | "sum"): number {
  return method === "mean" ? Math.max(1, Math.ceil(nItems / 2)) : Math.max(1, nItems);
}

function scaleScore(
  ds: CellSource,
  byName: Map<string, VariableSchema>,
  items: string[],
  op: "scale_mean" | "scale_sum",
  minItems: number | null,
): { values: (number | null)[]; warns: EditWarning[] } {
  const warns: EditWarning[] = [];
  const cols: number[][] = [];
  for (const name of items) {
    const v = byName.get(name);
    if (!v) throw rpcError(-32003, `The scale refers to '${name}', which is not in the dataset.`, "InvalidParams");
    const { x, warns: w } = itemScores(ds, v);
    warns.push(...w);
    cols.push(x);
  }
  const threshold = minItems ?? (op === "scale_mean" ? 1 : items.length);
  const out: (number | null)[] = [];
  for (let r = 0; r < ds.nRows; r++) {
    let sum = 0;
    let n = 0;
    for (const col of cols) {
      const x = col[r];
      if (!Number.isNaN(x)) {
        sum += x;
        n++;
      }
    }
    out.push(n >= threshold ? (op === "scale_mean" ? sum / Math.max(n, 1) : sum) : null);
  }
  return { values: out, warns };
}

function recodeCompute(
  ds: CellSource,
  v: VariableSchema,
  rules: RecodeRule[],
  unmatched: "keep" | "missing",
): { dtype: StorageDtype; values: CellValue[] } {
  const out: CellValue[] = [];
  for (let r = 0; r < ds.nRows; r++) {
    const raw = cellFor(ds, v.name, r);
    if (!isValidCell(v, raw)) {
      out.push(null);
      continue;
    }
    let hit = false;
    let val: CellValue = null;
    for (const rule of rules) {
      if (rule.from_values) {
        if (rule.from_values.some((fv) => valuesSame(raw, fv))) {
          hit = true;
          val = rule.to;
        }
      } else if (rule.from_range) {
        const n = numOrNull(raw);
        if (n !== null && n >= rule.from_range.min && n <= rule.from_range.max) {
          hit = true;
          val = rule.to;
        }
      }
      if (hit) break;
    }
    if (!hit) val = unmatched === "keep" ? raw : null;
    out.push(val);
  }
  const present = out.filter((x): x is number | string | boolean => x !== null);
  const numeric = present.every((x) => typeof x !== "string" && numOrNull(x) !== null);
  if (numeric) {
    const allInt = present.every((x) => Number.isInteger(Number(x)));
    return {
      dtype: allInt ? "integer" : "float",
      values: out.map((x) => (x === null ? null : Number(x))),
    };
  }
  return { dtype: "string", values: out.map((x) => (x === null ? null : String(x))) };
}

function dependenciesOf(defn: ComputedDefinition): string[] {
  if (defn.op === "difference") return [defn.minuend.variable, defn.subtrahend.variable];
  if (defn.op === "normalized_gain") return [defn.pre.variable, defn.post.variable];
  if (defn.op === "recode") return [defn.source];
  return [...defn.items];
}

function dependents(meta: DatasetMeta, name: string): string[] {
  return meta.variables.filter((v) => v.computed && dependenciesOf(v.computed).includes(name)).map((v) => v.name);
}

function normalizeIdValue(raw: CellValue, trim: boolean, caseInsensitive: boolean): string | null {
  if (raw === null) return null;
  let s = String(raw);
  if (trim) s = s.trim();
  if (caseInsensitive) s = s.toLowerCase();
  return s === "" ? null : s;
}

function operandValues(
  ds: CellSource,
  meta: DatasetMeta,
  byName: Map<string, VariableSchema>,
  operand: VariableOperand,
  purpose: string,
): { values: number[]; warns: EditWarning[] } {
  const v = byName.get(operand.variable);
  if (!v) throw rpcError(-32003, `'${operand.variable}' is not in the dataset.`, "InvalidParams");
  const x = numericColumn(ds, v, purpose);
  if (!operand.time_level) return { values: x, warns: [] };
  const stacking = meta.stacking;
  const link = meta.link;
  if (!stacking || link.mode !== "linked" || !link.id_variable) {
    throw rpcError(
      -32003,
      "To compare one time point with another for the same person, first link people across time (Data screen > " +
        "Link people by an ID). Without linking, Statly can't tell which rows belong to the same person.",
      "InvalidParams",
    );
  }
  const levels = stacking.levels.map((l) => l.label);
  if (!levels.includes(operand.time_level)) {
    throw rpcError(-32003, `'${operand.time_level}' is not one of this dataset's time points (${levels.join(", ")}).`, "InvalidParams");
  }
  const norm = link.normalization ?? { trim_whitespace: true, case_insensitive: true };
  const ids: (string | null)[] = new Array(ds.nRows);
  for (let r = 0; r < ds.nRows; r++) ids[r] = normalizeIdValue(cellFor(ds, link.id_variable, r), norm.trim_whitespace, norm.case_insensitive);
  const atLevel = new Map<string, number[]>();
  for (let r = 0; r < ds.nRows; r++) {
    const lvl = String(cellFor(ds, stacking.time_variable, r));
    if (lvl !== operand.time_level) continue;
    const id = ids[r];
    if (id === null) continue;
    const list = atLevel.get(id) ?? [];
    list.push(x[r]);
    atLevel.set(id, list);
  }
  const warns: EditWarning[] = [];
  const dup = [...atLevel.entries()].filter(([, l]) => l.length > 1);
  if (dup.length) {
    const n = dup.length;
    warns.push({
      code: "duplicate_ids_at_level",
      message: `${n} ID${n !== 1 ? "s" : ""} appear more than once at ${operand.time_level}, so Statly can't tell which answer to use; those people get a missing value.`,
      variable: operand.variable,
    });
  }
  const lookup = new Map<string, number>();
  for (const [id, list] of atLevel) if (list.length === 1) lookup.set(id, list[0]);
  const values = ids.map((id) => (id !== null && lookup.has(id) ? lookup.get(id)! : NaN));
  return { values, warns };
}

function differenceOp(
  ds: CellSource,
  meta: DatasetMeta,
  byName: Map<string, VariableSchema>,
  defn: Extract<ComputedDefinition, { op: "difference" }>,
): { values: (number | null)[]; warns: EditWarning[] } {
  const { values: a, warns: w1 } = operandValues(ds, meta, byName, defn.minuend, "in a gain score");
  const { values: b, warns: w2 } = operandValues(ds, meta, byName, defn.subtrahend, "in a gain score");
  const values = a.map((av, i) => (Number.isNaN(av) || Number.isNaN(b[i]) ? null : av - b[i]));
  return { values, warns: [...w1, ...w2] };
}

function normalizedGainOp(
  ds: CellSource,
  meta: DatasetMeta,
  byName: Map<string, VariableSchema>,
  defn: Extract<ComputedDefinition, { op: "normalized_gain" }>,
): { values: (number | null)[]; warns: EditWarning[] } {
  const { values: pre, warns: w1 } = operandValues(ds, meta, byName, defn.pre, "in a normalized gain");
  const { values: post, warns: w2 } = operandValues(ds, meta, byName, defn.post, "in a normalized gain");
  const mx = defn.max_score;
  const warns = [...w1, ...w2];
  let atMax = 0;
  let over = 0;
  const values: (number | null)[] = [];
  for (let i = 0; i < pre.length; i++) {
    const p = pre[i];
    const q = post[i];
    if (Number.isNaN(p) || Number.isNaN(q)) {
      values.push(null);
      continue;
    }
    if (p > mx || q > mx) over++;
    if (p === mx) {
      atMax++;
      values.push(null);
      continue;
    }
    values.push((q - p) / (mx - p));
  }
  if (atMax) {
    warns.push({
      code: "gain_at_ceiling",
      message: `${atMax} row${atMax !== 1 ? "s" : ""} already had the maximum score (${fmtNum(mx)}) at the start, so there was no room to gain; their normalized gain is missing.`,
      variable: null,
    });
  }
  if (over) {
    warns.push({
      code: "above_max_score",
      message: `${over} score${over !== 1 ? "s are" : " is"} higher than the maximum score you entered (${fmtNum(mx)}). Check the maximum possible score.`,
      variable: null,
    });
  }
  return { values, warns };
}

function evaluateDefinition(
  ds: CellSource,
  meta: DatasetMeta,
  defn: ComputedDefinition,
): { dtype: StorageDtype; values: CellValue[]; warns: EditWarning[] } {
  const byName = byNameMap(meta);
  for (const dep of dependenciesOf(defn)) {
    if (!byName.has(dep)) throw rpcError(-32003, `The calculation uses '${dep}', which is not in the dataset.`, "InvalidParams");
  }
  if (defn.op === "difference") {
    const { values, warns } = differenceOp(ds, meta, byName, defn);
    return { dtype: "float", values, warns };
  }
  if (defn.op === "normalized_gain") {
    const { values, warns } = normalizedGainOp(ds, meta, byName, defn);
    return { dtype: "float", values, warns };
  }
  if (defn.op === "recode") {
    const src = byName.get(defn.source)!;
    const { dtype, values } = recodeCompute(ds, src, defn.rules, defn.unmatched);
    return { dtype, values, warns: [] };
  }
  const { values, warns } = scaleScore(ds, byName, defn.items, defn.op, defn.min_items);
  return { dtype: "float", values, warns };
}

function checkDefinition(meta: DatasetMeta, defn: ComputedDefinition): void {
  if ((defn.op === "scale_mean" || defn.op === "scale_sum") && defn.min_items != null && defn.min_items > defn.items.length) {
    throw rpcError(
      -32003,
      `The minimum number of answered items (${defn.min_items}) is more than the ${defn.items.length} items chosen.`,
      "InvalidParams",
    );
  }
  const byName = byNameMap(meta);
  for (const dep of dependenciesOf(defn)) {
    if (!byName.has(dep)) throw rpcError(-32003, `There is no variable called '${dep}'.`, "InvalidParams");
  }
}

const DEFAULT_ROLE: Record<ComputedDefinition["op"], VariableRole | null> = {
  difference: "unassigned",
  normalized_gain: "unassigned",
  scale_mean: "scale_score",
  scale_sum: "scale_score",
  recode: null,
};

function describeDefn(defn: ComputedDefinition): string {
  const opnd = (o: VariableOperand) => o.variable + (o.time_level ? ` at ${o.time_level}` : "");
  if (defn.op === "difference") return `Gain score: ${opnd(defn.minuend)} minus ${opnd(defn.subtrahend)}`;
  if (defn.op === "normalized_gain") {
    return `Normalized gain: (${opnd(defn.post)} - ${opnd(defn.pre)}) / (${fmtNum(defn.max_score)} - ${opnd(defn.pre)})`;
  }
  if (defn.op === "recode") return `Recode of ${defn.source}`;
  return `${defn.op === "scale_mean" ? "Average" : "Sum"} of ${defn.items.join(", ")}`;
}

function computedVariable(meta: DatasetMeta, p: ComputedAddParams): VariableSchema {
  const defn = p.definition;
  const byName = byNameMap(meta);
  let role: VariableRole | null = p.role ?? null;
  if (role === null) {
    role = DEFAULT_ROLE[defn.op];
    if (defn.op === "difference" || defn.op === "normalized_gain") {
      const ops = defn.op === "difference" ? [defn.minuend, defn.subtrahend] : [defn.post, defn.pre];
      const roles = new Set(ops.map((o) => byName.get(o.variable)!.role));
      if (roles.size === 1) {
        const only = [...roles][0];
        if (only === "test_total" || only === "scale_score") role = only;
      }
    }
    if (defn.op === "recode") role = byName.get(defn.source)!.role;
  }
  const level = p.level ?? (defn.op !== "recode" ? "continuous" : byName.get(defn.source)!.level);
  return newVariable(p.name.trim(), {
    label: p.label ?? null,
    role: role ?? "unassigned",
    level,
    computed: clone(defn),
    question_text: describeDefn(defn),
  });
}

function renumber(meta: DatasetMeta, priority: Set<string> = new Set()): void {
  const idx = meta.variables.map((v, i) => ({ v, i }));
  idx.sort((a, b) => {
    if (a.v.display_order !== b.v.display_order) return a.v.display_order - b.v.display_order;
    const ap = priority.has(a.v.name) ? 0 : 1;
    const bp = priority.has(b.v.name) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.i - b.i;
  });
  idx.forEach(({ v }, k) => {
    v.display_order = k;
  });
}

function insertAfter(meta: DatasetMeta, newVar: VariableSchema, after: string | null): void {
  const byName = byNameMap(meta);
  if (after !== null && byName.has(after)) {
    const pos = byName.get(after)!.display_order + 1;
    for (const v of meta.variables) if (v.display_order >= pos) v.display_order += 1;
    newVar.display_order = pos;
  } else {
    newVar.display_order = 1 + Math.max(-1, ...meta.variables.map((v) => v.display_order));
  }
  meta.variables.push(newVar);
  renumber(meta);
}

function newVariable(name: string, o: Partial<VariableSchema> = {}): VariableSchema {
  return makeVariable(name, { level: "continuous", dtype: "float", ...o });
}

function uniqueName(meta: DatasetMeta, base: string): string {
  const taken = new Set(meta.variables.map((v) => v.name));
  taken.add("_statly_row_id");
  let name = base;
  let k = 1;
  while (taken.has(name)) {
    k++;
    name = `${base}_${k}`;
  }
  return name;
}

function checkNewName(meta: DatasetMeta, name: string): void {
  if (!name || !name.trim()) throw rpcError(-32003, "Give the new variable a name.", "InvalidParams");
  if (name === "_statly_row_id" || name.startsWith("_statly")) {
    throw rpcError(-32003, `'${name}' is reserved; choose another name.`, "InvalidParams");
  }
  if (byNameMap(meta).has(name)) throw rpcError(-32003, `There is already a variable called '${name}'. Choose another name.`, "InvalidParams");
}

function removeScaleFromMeta(meta: DatasetMeta, scale: Scale): void {
  const byName = byNameMap(meta);
  for (const item of scale.items) {
    if (byName.has(item) && byName.get(item)!.scale_id === scale.id) byName.get(item)!.scale_id = null;
  }
  const score = scale.score_variable;
  if (score && byName.has(score)) {
    const users = dependents(meta, score);
    if (users.length) {
      throw rpcError(-32003, `The score '${score}' is used by ${users.join(", ")}. Remove those calculations first.`, "InvalidParams");
    }
    meta.variables = meta.variables.filter((v) => v.name !== score);
  }
  meta.scales = meta.scales.filter((s) => s.id !== scale.id);
  renumber(meta);
}

function commonPrefix(items: string[]): string | null {
  const re = /^(.+?)_\d+$/;
  const prefixes = new Set<string>();
  let allMatch = true;
  for (const i of items) {
    const m = re.exec(i);
    if (m) prefixes.add(m[1]);
    else allMatch = false;
  }
  return allMatch && prefixes.size === 1 ? [...prefixes][0] : null;
}

function observedAnswers(ds: CellSource, v: VariableSchema): (string | number)[] {
  const seen = new Map<string, string | number>();
  for (let r = 0; r < ds.nRows; r++) {
    const raw = cellFor(ds, v.name, r);
    if (!isValidCell(v, raw)) continue;
    const key = String(raw).trim();
    if (key && !seen.has(key)) seen.set(key, typeof raw === "string" ? raw.trim() : (raw as number));
  }
  return [...seen.values()];
}

function answerKeyRules(ds: CellSource, v: VariableSchema, correct: (number | string)[]): { rules: RecodeRule[]; warns: EditWarning[] } {
  const observed = observedAnswers(ds, v);
  const byFold = new Map(observed.map((o) => [String(o).trim().toLowerCase(), o]));
  const right: (number | string)[] = [];
  const warns: EditWarning[] = [];
  for (const c of correct) {
    let hit = byFold.get(String(c).trim().toLowerCase());
    if (hit === undefined && numOrNull(c) !== null) hit = observed.find((o) => valuesSame(o, c));
    if (hit === undefined) {
      warns.push({
        code: "key_not_observed",
        message: `Nobody chose '${c}' on ${v.name}, the answer marked correct. Check the answer key for this question.`,
        variable: v.name,
      });
      right.push(c);
    } else {
      right.push(hit);
    }
  }
  const wrong = observed.filter((o) => !right.some((r) => valuesSame(o, r)));
  const rules: RecodeRule[] = [{ from_values: right, from_range: null, to: 1 }];
  if (wrong.length) rules.push({ from_values: wrong, from_range: null, to: 0 });
  return { rules, warns };
}

function updateLabel(updates: VariablePatch[], changed: string[]): string {
  const pretty: Record<string, string> = {
    role: "role",
    level: "measurement level",
    label: "label",
    question_text: "question text",
    value_labels: "value labels",
    reverse_coded: "reverse-scoring",
    response_range: "answer range",
    missing_codes: "missing-value codes",
    display_order: "position",
  };
  if (changed.length === 1) {
    const fields = Object.keys(updates[0]).filter((k) => k !== "name");
    if (fields.length === 1) return `Changed ${pretty[fields[0]] ?? fields[0]} of ${changed[0]}`;
    return `Edited ${changed[0]}`;
  }
  return `Edited ${changed.length} variables`;
}

function metaCompareKey(meta: DatasetMeta): string {
  return JSON.stringify({ variables: meta.variables, scales: meta.scales });
}

function mapCompareKey(m: Map<string, CellValue[]>): string {
  return JSON.stringify([...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

/** Re-evaluate every computed variable (dependencies first); fills ds.computedCols. */
function recomputeAll(ds: CellSource, meta: DatasetMeta): EditWarning[] {
  ds.computedCols = new Map();
  const warns: EditWarning[] = [];
  const pending = new Map(meta.variables.filter((v) => v.computed).map((v) => [v.name, v]));
  while (pending.size) {
    const ready = [...pending.values()].filter((v) => dependenciesOf(v.computed!).every((d) => !pending.has(d)));
    if (!ready.length) {
      throw rpcError(
        -32003,
        "These calculated variables depend on each other in a loop: " + [...pending.keys()].sort().join(", ") + ".",
        "InvalidParams",
      );
    }
    for (const v of ready) {
      const { dtype, values, warns: w } = evaluateDefinition(ds, meta, v.computed!);
      v.dtype = dtype;
      ds.computedCols.set(v.name, values);
      warns.push(...w);
      pending.delete(v.name);
    }
  }
  return warns;
}

// --- the engine --------------------------------------------------------------------------

interface SavedProject {
  project: ProjectFile;
  savedAt: string;
}

export interface MockEngineOptions {
  /** Artificial latency per call in ms (default 40; tests use 0). */
  latencyMs?: number;
  /** Seed one recoverable autosave (of the example project) to exercise crash recovery. */
  seedAutosave?: boolean;
}

export class MockEngine implements Transport {
  private previews = new Map<string, Staged>();
  private datasets = new Map<string, DatasetState>();
  private saved = new Map<string, SavedProject>();
  private autosaves = new Map<string, { project: ProjectFile; marker: ProjectLoadResult["autosave_marker"] & object }>();
  private counter = 0;
  readonly calls: { method: string; params: unknown }[] = [];
  private latency: number;

  constructor(opts: MockEngineOptions = {}) {
    this.latency = opts.latencyMs ?? 40;
    const example = exampleProject as unknown as ProjectFile;
    this.saved.set(MOCK_EXAMPLE_PROJECT_PATH, { project: example, savedAt: example.modified_at });
    if (opts.seedAutosave) {
      const p = clone(example);
      p.name = "Example project (unsaved changes)";
      this.autosaves.set(`/mock/autosave/${p.project_id}.statly`, {
        project: p,
        marker: { schema_version: 1, project_id: p.project_id, original_path: MOCK_EXAMPLE_PROJECT_PATH, saved_at: nowIso() },
      });
    }
  }

  async call<T>(method: string, params: object): Promise<T> {
    this.calls.push({ method, params: clone(params) });
    if (this.latency) await new Promise((r) => setTimeout(r, this.latency));
    const p = params as never;
    switch (method) {
      case "ping":
        return { pong: true, engine_version: "0.1.0-mock", python_version: "mock", platform: "browser" } as T;
      case "engine.info":
        return { engine_version: "0.1.0-mock", python_version: "mock", platform: "browser", libraries: { mock: "1" } } as T;
      case "dataset.import_preview":
        return this.importPreview(p) as T;
      case "dataset.import":
        return this.importDataset(p) as T;
      case "dataset.stack":
        return this.stack(p) as T;
      case "dataset.link":
        return this.link(p) as T;
      case "dataset.rows":
        return this.rows(p) as T;
      case "dataset.missing_summary":
        return this.missing(p) as T;
      case "variables.update":
        return this.updateVariables(p) as T;
      case "scales.upsert":
        return this.upsertScale(p) as T;
      case "scales.delete":
        return this.deleteScale(p) as T;
      case "items.score":
        return this.scoreItems(p) as T;
      case "items.parse_answer_key":
        return this.parseAnswerKey(p) as T;
      case "computed.preview":
        return this.computedPreview(p) as T;
      case "computed.add":
        return this.addComputed(p) as T;
      case "computed.remove":
        return this.removeComputed(p) as T;
      case "dataset.history":
        return this.datasetHistory(p) as T;
      case "dataset.restore_snapshot":
        return this.restoreSnapshot(p) as T;
      case "project.save":
        return this.save(p) as T;
      case "project.load":
        return this.load(p) as T;
      case "project.autosave":
        return this.autosave(p) as T;
      case "project.recoverable":
        return this.recoverable(p) as T;
      case "project.discard_autosave":
        return this.discard(p) as T;
      default:
        throw rpcError(-32601, `Method not found: ${method}`, "MethodNotFound");
    }
  }

  private nextId(prefix: string) {
    return `${prefix}_${++this.counter}`;
  }

  importPreview(p: DatasetImportPreviewParams): DatasetImportPreviewResult {
    previewPaths = p.files.map((f) => f.path);
    const files = p.files.map((f, i) => stageFile(f.path, f.sheet_name, i));
    if (p.qualtrics_mode !== "auto") {
      for (const f of files) {
        f.preview.qualtrics.detected = p.qualtrics_mode === "on" ? true : f.preview.qualtrics.detected;
        if (p.qualtrics_mode === "off") f.preview.qualtrics = { detected: f.preview.qualtrics.detected, confirmed: true, header_rows: 1 };
      }
    }
    const previewId = this.nextId("preview");
    this.previews.set(previewId, { files });
    const previews = files.map((f) => f.preview);
    let stack: ColumnMatch[] | null = null;
    if (files.length > 1) stack = proposeStack(previews);
    if (p.stack_onto_dataset_id) {
      const ds = this.getDataset(p.stack_onto_dataset_id);
      const existing: FilePreview = { ...previews[0], file_id: "existing", proposed_variables: ds.meta.variables };
      stack = proposeStack([existing, ...previews]).map((m) => ({ ...m, columns: m.columns.filter((c) => c.file_id !== "existing") }));
    }
    return { preview_id: previewId, files: clone(previews), stack_proposal: stack };
  }

  private getDataset(id: string): DatasetState {
    const ds = this.datasets.get(id);
    if (!ds) throw rpcError(-32002, `Unknown dataset_id ${id}`, "StaleSnapshot");
    return ds;
  }

  private build(
    staged: Staged,
    decisions: ImportFileDecision[],
    rowFilters: RowFilter[],
    userVars: VariableSchema[],
    stack: StackConfig | null,
    datasetId: string,
  ): { nRows: number; columns: string[]; cell: (r: number, col: string) => CellValue; meta: DatasetMeta } {
    const files = decisions.map((d) => {
      const f = staged.files.find((s) => s.preview.file_id === d.file_id);
      if (!f) throw rpcError(-32003, `Unknown file_id ${d.file_id}`, "InvalidParams");
      return { f, d };
    });
    if (files.length > 1 && !stack) throw rpcError(-32003, "stack is required for 2+ files", "InvalidParams");

    // Resolve output columns: name -> per-file source column.
    type Out = { name: string; source: Map<string, string>; proto: VariableSchema };
    const outs: Out[] = [];
    const dropped = new Map(decisions.map((d) => [d.file_id, new Set(d.drop_columns)]));
    const protoFor = (fileId: string, col: string) =>
      staged.files.find((s) => s.preview.file_id === fileId)!.preview.proposed_variables.find((v) => v.name === col)!;
    if (stack) {
      for (const m of stack.column_matches) {
        const cols = m.columns.filter((c) => !dropped.get(c.file_id)?.has(c.column));
        if (!cols.length) continue;
        outs.push({ name: m.variable, source: new Map(cols.map((c) => [c.file_id, c.column])), proto: protoFor(cols[0].file_id, cols[0].column) });
      }
    } else {
      const { f } = files[0];
      for (const v of f.preview.proposed_variables) {
        if (dropped.get(f.preview.file_id)?.has(v.name)) continue;
        outs.push({ name: v.name, source: new Map([[f.preview.file_id, v.name]]), proto: v });
      }
    }

    // Rows that survive the filters, in file (time-level) order.
    const levelOrder = stack ? stack.levels.map((l) => l.file_id) : [files[0].f.preview.file_id];
    const rowIndex: { f: StagedFile; r: number; level: string }[] = [];
    const kept = new Map<string, number>();
    for (const fid of levelOrder) {
      const f = files.find((x) => x.f.preview.file_id === fid)?.f;
      if (!f) continue;
      const label = stack?.levels.find((l) => l.file_id === fid)?.label ?? "";
      let k = 0;
      for (let r = 0; r < f.shape.nRows; r++) {
        if (passesFilters(f, r, rowFilters)) {
          rowIndex.push({ f, r, level: label });
          k++;
        }
      }
      kept.set(fid, k);
    }

    const userByName = new Map(userVars.map((v) => [v.name, v]));
    const variables: VariableSchema[] = [];
    if (stack) {
      variables.push(
        makeVariable(stack.time_variable, {
          role: "time",
          level: "ordinal",
          value_labels: stack.levels.map((l) => ({ value: l.label, label: l.label })),
          display_order: 0,
        }),
      );
    }
    for (const o of outs) {
      const base = userByName.get(o.name) ?? o.proto;
      variables.push({
        ...clone(base),
        name: o.name,
        display_order: variables.length,
        sources: [...o.source].map(([fid, col]) => ({ ...protoFor(fid, col).sources[0], file_id: fid, original_column_name: col })),
      });
    }
    // Multi-select split: indicator variables whose sources[0] is the multi-select column.
    const indicators = new Map<string, { column: string; option: string }>();
    for (const uv of userVars) {
      if (outs.some((o) => o.name === uv.name)) continue;
      const col = uv.sources[0]?.original_column_name;
      if (!col || !uv.label || !files.some(({ f }) => f.shape.multiselect.includes(col))) {
        throw rpcError(-32003, `Variable '${uv.name}' does not correspond to any imported column.`, "InvalidParams");
      }
      indicators.set(uv.name, { column: col, option: uv.label });
      variables.push({ ...clone(uv), dtype: "integer", display_order: variables.length });
    }
    const varByName = new Map(variables.map((v) => [v.name, v]));
    const outByName = new Map(outs.map((o) => [o.name, o]));

    const cell = (r: number, col: string): CellValue => {
      const row = rowIndex[r];
      if (!row) return null;
      if (stack && col === stack.time_variable) return row.level;
      const ind = indicators.get(col);
      if (ind) {
        const raw = row.f.cell(row.r, ind.column);
        if (isBlank(raw)) return null;
        return String(raw).split(",").map((t) => t.trim()).includes(ind.option) ? 1 : 0;
      }
      const o = outByName.get(col);
      const src = o?.source.get(row.f.preview.file_id);
      if (!src) return null;
      const raw = row.f.cell(row.r, src);
      // Text choices confirmed with numeric codes: map label -> code.
      const v = varByName.get(col);
      if (typeof raw === "string" && v && v.value_labels.length && typeof v.value_labels[0].value === "number") {
        const hit = v.value_labels.find((l) => l.label === raw);
        if (hit) return hit.value;
        const n = Number(raw);
        if (raw.trim() !== "" && Number.isFinite(n)) return n;
      }
      return raw;
    };
    for (const v of variables) {
      if (typeof v.value_labels[0]?.value === "number" && v.dtype === "string") {
        v.dtype = "integer";
        v.missing_codes = v.missing_codes.map((c) => (typeof c === "string" && Number.isFinite(Number(c)) ? Number(c) : c));
      }
    }

    const imported: ImportedFile[] = files.map(({ f, d }) => ({
      file_id: f.preview.file_id,
      name: f.preview.name,
      sha256: f.preview.sha256,
      size_bytes: f.preview.size_bytes,
      format: f.preview.format,
      encoding: d.encoding ?? f.preview.encoding,
      delimiter: d.delimiter ?? f.preview.delimiter,
      sheet_name: d.sheet_name ?? f.preview.sheet_name,
      qualtrics: { detected: f.preview.qualtrics.detected, confirmed: true, header_rows: d.qualtrics_header_rows },
      time_label: d.time_label,
      n_rows_read: f.shape.nRows,
      n_rows_kept: kept.get(f.preview.file_id) ?? 0,
      stored_path: `originals/${f.preview.file_id}/${f.preview.name}`,
      imported_at: nowIso(),
    }));
    const appliedFilters = rowFilters.map((flt) => {
      let removed = 0;
      for (const { f } of files) {
        if (flt.file_id && flt.file_id !== f.preview.file_id) continue;
        for (let r = 0; r < f.shape.nRows; r++) if (!passesFilters(f, r, [flt])) removed++;
      }
      return { ...flt, rows_removed: removed };
    });
    const partial = { nRows: rowIndex.length, columns: variables.map((v) => v.name), cell };
    const meta: DatasetMeta = {
      schema_version: 1,
      dataset_id: datasetId,
      snapshot_id: this.nextId("snap"),
      n_rows: rowIndex.length,
      row_id_column: "_statly_row_id",
      variables,
      scales: staged.files.flatMap((f) => f.preview.suggested_scales).filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i),
      import_log: {
        files: imported,
        row_filters: appliedFilters,
        dropped_columns: decisions.flatMap((d) => d.drop_columns.map((column) => ({ file_id: d.file_id, column, reason: "pii" as const }))),
      },
      stacking: stack ? { time_variable: stack.time_variable, levels: stack.levels } : null,
      link: { mode: "aggregate", id_variable: null, normalization: null, counts: null },
      missing_summary: missingSummary(partial, variables),
    };
    return { ...partial, meta };
  }

  /** Wrap a base cell accessor + meta into a full DatasetState (empty computed overlay, no history). */
  private makeDatasetState(meta: DatasetMeta, nRows: number, baseCell: (r: number, col: string) => CellValue): DatasetState {
    const ds: DatasetState = {
      meta,
      nRows,
      columns: meta.variables.map((v) => v.name),
      baseCell,
      computedCols: new Map(),
      history: [],
      cursor: -1,
      cell: () => null,
    };
    ds.cell = (r, col) => cellFor(ds, col, r);
    return ds;
  }

  private pushHistory(ds: DatasetState, label: string): void {
    ds.history = ds.history.slice(0, ds.cursor + 1);
    ds.history.push({ snapshot_id: ds.meta.snapshot_id, label, timestamp: nowIso(), meta: clone(ds.meta), computed: clone(ds.computedCols) });
    const evictBefore = ds.history.length - MAX_RESTORABLE;
    for (let i = 0; i < evictBefore; i++) ds.history[i] = { ...ds.history[i], meta: null, computed: null };
    ds.cursor = ds.history.length - 1;
  }

  private checkStale(ds: DatasetState, snapshotId: string | null | undefined): void {
    if (snapshotId != null && snapshotId !== ds.meta.snapshot_id) {
      throw rpcError(-32002, "The data changed since this was opened; please try again.", "StaleSnapshot");
    }
  }

  /** Recompute all computed columns for newMeta, commit if content changed, and push history. */
  private commitEdit(ds: DatasetState, newMeta: DatasetMeta, warns: EditWarning[], label: string): DatasetEditResult {
    const prevMetaKey = metaCompareKey(ds.meta);
    const prevComputedKey = mapCompareKey(ds.computedCols);
    const editWarns = recomputeAll(ds, newMeta);
    const allWarns = dedupeWarns([...warns, ...editWarns]);
    if (prevMetaKey === metaCompareKey(newMeta) && prevComputedKey === mapCompareKey(ds.computedCols)) {
      return { dataset_meta: clone(ds.meta), warnings: allWarns };
    }
    newMeta.snapshot_id = this.nextId("snap");
    newMeta.n_rows = ds.nRows;
    newMeta.missing_summary = missingSummary(ds, newMeta.variables);
    ds.meta = newMeta;
    ds.columns = newMeta.variables.map((v) => v.name);
    this.pushHistory(ds, label);
    return { dataset_meta: clone(ds.meta), warnings: allWarns };
  }

  importDataset(p: DatasetImportParams): DatasetResult {
    const staged = this.previews.get(p.preview_id);
    if (!staged) throw rpcError(-32002, `Unknown preview_id ${p.preview_id}`, "StalePreview");
    const built = this.build(staged, p.files, p.row_filters, p.variables, p.stack, this.nextId("ds"));
    const ds = this.makeDatasetState(built.meta, built.nRows, built.cell);
    this.datasets.set(ds.meta.dataset_id, ds);
    this.pushHistory(ds, "Imported data");
    return { dataset_meta: clone(ds.meta) };
  }

  stack(p: DatasetStackParams): DatasetResult {
    // Mock simplification: the appended files replace nothing; they are appended as new levels.
    const ds = this.getDataset(p.dataset_id);
    const staged = this.previews.get(p.preview_id);
    if (!staged) throw rpcError(-32002, `Unknown preview_id ${p.preview_id}`, "StalePreview");
    const add = this.build(staged, p.files, p.row_filters, p.variables, p.stack, ds.meta.dataset_id);
    const nOld = ds.nRows;
    const baseCell = (r: number, col: string) => (r < nOld ? ds.baseCell(r, col) : add.cell(r - nOld, col));
    const nRows = nOld + add.nRows;
    const meta: DatasetMeta = {
      ...ds.meta,
      snapshot_id: this.nextId("snap"),
      n_rows: nRows,
      import_log: {
        files: [...ds.meta.import_log.files, ...add.meta.import_log.files],
        row_filters: [...ds.meta.import_log.row_filters, ...add.meta.import_log.row_filters],
        dropped_columns: [...ds.meta.import_log.dropped_columns, ...add.meta.import_log.dropped_columns],
      },
      stacking: {
        time_variable: p.stack.time_variable,
        levels: [...(ds.meta.stacking?.levels ?? []), ...p.stack.levels],
      },
    };
    const next = this.makeDatasetState(meta, nRows, baseCell);
    next.history = ds.history;
    next.cursor = ds.cursor;
    recomputeAll(next, meta);
    meta.missing_summary = missingSummary(next, meta.variables);
    this.datasets.set(meta.dataset_id, next);
    this.pushHistory(next, "Stacked data");
    return { dataset_meta: clone(meta) };
  }

  link(p: DatasetLinkParams): DatasetLinkResult {
    const ds = this.getDataset(p.dataset_id);
    if (p.mode === "aggregate") {
      ds.meta = { ...ds.meta, snapshot_id: this.nextId("snap"), link: { mode: "aggregate", id_variable: null, normalization: null, counts: null } };
      recomputeAll(ds, ds.meta);
      ds.meta.missing_summary = missingSummary(ds, ds.meta.variables);
      this.pushHistory(ds, "Unlinked people across time");
      return { dataset_meta: clone(ds.meta), report: null };
    }
    if (!p.id_variable || !ds.columns.includes(p.id_variable)) {
      throw rpcError(-32003, "id_variable must name a dataset variable in linked mode", "InvalidParams");
    }
    const norm = p.normalization ?? { trim_whitespace: true, case_insensitive: true };
    const timeVar = ds.meta.stacking?.time_variable;
    const levels = ds.meta.stacking?.levels.map((l) => l.label) ?? [""];
    const perLevel = new Map<string, Map<string, number>>(levels.map((l) => [l, new Map()]));
    for (let r = 0; r < ds.nRows; r++) {
      let id = ds.cell(r, p.id_variable);
      if (isBlank(id)) continue;
      id = String(id);
      if (norm.trim_whitespace) id = id.trim();
      if (norm.case_insensitive) id = id.toLowerCase();
      const lvl = timeVar ? String(ds.cell(r, timeVar)) : "";
      const m = perLevel.get(lvl);
      if (m) m.set(id, (m.get(id) ?? 0) + 1);
    }
    const all = new Set<string>();
    perLevel.forEach((m) => m.forEach((_n, id) => all.add(id)));
    const matched: string[] = [];
    const unmatched: string[] = [];
    const dup = new Set<string>();
    all.forEach((id) => {
      if ([...perLevel.values()].every((m) => m.has(id))) matched.push(id);
      else unmatched.push(id);
    });
    perLevel.forEach((m) => m.forEach((n, id) => n > 1 && dup.add(id)));
    const counts: LinkCounts = { matched: matched.length, unmatched: unmatched.length, duplicate: dup.size };
    ds.meta = {
      ...ds.meta,
      snapshot_id: this.nextId("snap"),
      link: { mode: "linked", id_variable: p.id_variable, normalization: norm, counts },
    };
    recomputeAll(ds, ds.meta);
    ds.meta.missing_summary = missingSummary(ds, ds.meta.variables);
    this.pushHistory(ds, "Linked people across time");
    return {
      dataset_meta: clone(ds.meta),
      report: {
        counts,
        unmatched_ids: unmatched.sort().slice(0, 200),
        duplicate_ids: [...dup].sort().slice(0, 200),
        explanation: `${counts.matched} people answered at every time point and can be compared with themselves. ${counts.unmatched} people are missing from at least one time point: they stay in your data for group comparisons but are left out of paired and repeated-measures tests.`,
      },
    };
  }

  // --- Phase 2: variable interview RPCs ---------------------------------------------------

  updateVariables(p: VariablesUpdateParams): DatasetEditResult {
    const ds = this.getDataset(p.dataset_id);
    this.checkStale(ds, p.snapshot_id);
    if (!p.updates.length) throw rpcError(-32003, "There are no changes to apply.", "InvalidParams");
    const newMeta = clone(ds.meta);
    const byName = byNameMap(newMeta);
    const patchFields = [
      "role",
      "level",
      "label",
      "question_text",
      "value_labels",
      "reverse_coded",
      "response_range",
      "missing_codes",
      "display_order",
    ];
    const moved = new Set<string>();
    const changed: string[] = [];
    for (const patch of p.updates) {
      const v = byName.get(patch.name);
      if (!v) throw rpcError(-32003, `There is no variable called '${patch.name}'.`, "InvalidParams");
      for (const k of Object.keys(patch)) {
        if (k === "name") continue;
        if (!patchFields.includes(k)) throw rpcError(-32003, `'${k}' can't be changed here.`, "InvalidParams");
        (v as unknown as Record<string, unknown>)[k] = clone((patch as unknown as Record<string, unknown>)[k]);
        if (k === "display_order") moved.add(v.name);
      }
      const vals = v.value_labels.map((l) => String(l.value));
      if (new Set(vals).size !== vals.length) {
        throw rpcError(-32003, `'${v.name}' has the same answer code listed twice in its value labels.`, "InvalidParams");
      }
      if (v.reverse_coded && !NUMERIC_DTYPES.includes(v.dtype)) {
        throw rpcError(-32003, `'${v.name}' holds text, so it can't be reverse-scored. Confirm its answer codes first.`, "InvalidParams");
      }
      if (v.response_range && v.response_range.min >= v.response_range.max) {
        throw rpcError(-32003, `The answer range for '${v.name}' must go from a lower to a higher number.`, "InvalidParams");
      }
      if (!changed.includes(v.name)) changed.push(v.name);
    }
    if (moved.size) renumber(newMeta, moved);
    return this.commitEdit(ds, newMeta, [], p.label || updateLabel(p.updates, changed));
  }

  upsertScale(p: ScalesUpsertParams): DatasetEditResult {
    const ds = this.getDataset(p.dataset_id);
    this.checkStale(ds, p.snapshot_id);
    const newMeta = clone(ds.meta);
    const spec = p.scale;
    const name = spec.name.trim();
    if (!name) throw rpcError(-32003, "Give the scale a name.", "InvalidParams");
    const items = [...new Set(spec.items)];
    if (items.length < 2) {
      throw rpcError(-32003, "A scale needs at least two items. Add more questions that measure the same idea.", "InvalidParams");
    }
    let byName = byNameMap(newMeta);
    for (const it of items) {
      const v = byName.get(it);
      if (!v) throw rpcError(-32003, `There is no variable called '${it}'.`, "InvalidParams");
      if (!NUMERIC_DTYPES.includes(v.dtype)) {
        throw rpcError(-32003, `'${it}' holds text, so it can't be part of a scale score. Confirm its answer codes first.`, "InvalidParams");
      }
      if (v.computed && (v.computed.op === "scale_mean" || v.computed.op === "scale_sum")) {
        throw rpcError(-32003, `'${it}' is itself a scale score, so it can't be an item.`, "InvalidParams");
      }
    }
    const method = spec.scoring_method;
    const minItems = "min_items" in spec ? (spec.min_items ?? null) : defaultMinItems(items.length, method);
    if (minItems !== null && minItems > items.length) {
      throw rpcError(
        -32003,
        `The minimum number of answered items (${minItems}) is more than the ${items.length} items in the scale.`,
        "InvalidParams",
      );
    }

    const warns: EditWarning[] = [];
    let scale = spec.id ? (newMeta.scales.find((s) => s.id === spec.id) ?? null) : null;
    if (!scale) {
      let sid = spec.id || `scale_${slug(name)}`;
      const base = sid;
      let k = 1;
      while (newMeta.scales.some((s) => s.id === sid)) {
        k++;
        sid = `${base}_${k}`;
      }
      scale = { id: sid, name, items: [], scoring_method: method, min_items: minItems, score_variable: null, origin: "user" };
      newMeta.scales.push(scale);
    }

    for (const other of [...newMeta.scales]) {
      if (other.id === scale.id) continue;
      const taken = other.items.filter((i) => items.includes(i));
      if (!taken.length) continue;
      other.items = other.items.filter((i) => !items.includes(i));
      if (other.items.length < 2) {
        removeScaleFromMeta(newMeta, other);
        warns.push({ code: "scale_removed", message: `The scale '${other.name}' had fewer than two items left, so it was removed.`, variable: null });
      } else if (other.score_variable) {
        const sv = byNameMap(newMeta).get(other.score_variable);
        if (sv?.computed && (sv.computed.op === "scale_mean" || sv.computed.op === "scale_sum")) {
          sv.computed.items = [...other.items] as [string, ...string[]];
          if (sv.computed.min_items != null && sv.computed.min_items > other.items.length) {
            sv.computed.min_items = other.items.length;
            other.min_items = other.items.length;
          }
        }
      }
    }
    byName = byNameMap(newMeta);
    for (const old of scale.items) {
      if (!items.includes(old) && byName.has(old) && byName.get(old)!.scale_id === scale.id) {
        byName.get(old)!.scale_id = null;
      }
    }
    for (const it of items) {
      const v = byName.get(it)!;
      v.scale_id = scale.id;
      if (v.role === "unassigned") v.role = "likert_item";
    }
    scale.name = name;
    scale.items = items;
    scale.scoring_method = method;
    scale.min_items = minItems;

    const op: "scale_mean" | "scale_sum" = method === "mean" ? "scale_mean" : "scale_sum";
    const kind = method === "mean" ? "average" : "total";
    let score = scale.score_variable ? byName.get(scale.score_variable) : undefined;
    if (!score) {
      const requested = (spec.score_variable || "").trim();
      let scoreName: string;
      if (requested) {
        checkNewName(newMeta, requested);
        scoreName = requested;
      } else {
        scoreName = uniqueName(newMeta, `${slug(name)}_score`);
      }
      score = newVariable(scoreName, { role: "scale_score", level: "continuous", dtype: "float" });
      const lastItem = items.reduce((a, b) => (byName.get(b)!.display_order > byName.get(a)!.display_order ? b : a));
      insertAfter(newMeta, score, lastItem);
      scale.score_variable = scoreName;
      byName = byNameMap(newMeta);
    }
    score.computed = { op, items: items as [string, ...string[]], min_items: minItems, scale_id: scale.id };
    score.label = `${name} (${kind} score)`;
    score.question_text = `${method === "mean" ? "Average" : "Sum"} of ${items.join(", ")}`;

    return this.commitEdit(ds, newMeta, warns, `Scored scale ${name}`);
  }

  deleteScale(p: ScalesDeleteParams): DatasetEditResult {
    const ds = this.getDataset(p.dataset_id);
    this.checkStale(ds, p.snapshot_id);
    const newMeta = clone(ds.meta);
    const scale = newMeta.scales.find((s) => s.id === p.scale_id);
    if (!scale) throw rpcError(-32003, `There is no scale with id '${p.scale_id}'.`, "InvalidParams");
    removeScaleFromMeta(newMeta, scale);
    return this.commitEdit(ds, newMeta, [], `Removed scale ${scale.name}`);
  }

  scoreItems(p: ItemsScoreParams): DatasetEditResult {
    const ds = this.getDataset(p.dataset_id);
    this.checkStale(ds, p.snapshot_id);
    const key = p.key;
    if (!key.length) throw rpcError(-32003, "Enter the correct answer for at least one question.", "InvalidParams");
    const items = key.map((k) => k.item);
    if (new Set(items).size !== items.length) throw rpcError(-32003, "A question appears twice in the answer key.", "InvalidParams");
    const newMeta = clone(ds.meta);
    const warns: EditWarning[] = [];
    const scoredNames: string[] = [];
    let byName = byNameMap(newMeta);
    for (const entry of key) {
      const item = byName.get(entry.item);
      if (!item) throw rpcError(-32003, `There is no variable called '${entry.item}'.`, "InvalidParams");
      if (item.role === "unassigned" || item.role === "ignore") item.role = "test_item";
      const correct = entry.correct;
      if (correct === null) {
        if (!NUMERIC_DTYPES.includes(item.dtype)) {
          throw rpcError(-32003, `'${item.name}' holds answer text, so it needs a correct answer in the key.`, "InvalidParams");
        }
        scoredNames.push(item.name);
        continue;
      }
      if (!correct.length) throw rpcError(-32003, `Choose the correct answer for ${item.name}.`, "InvalidParams");
      const { rules, warns: w } = answerKeyRules(ds, item, correct);
      warns.push(...w);
      const defn: ComputedRecode = { op: "recode", source: item.name, rules: rules as [RecodeRule, ...RecodeRule[]], unmatched: "missing" };
      let target = `${item.name}_correct`;
      let existing = byName.get(target);
      if (existing && existing.computed?.op !== "recode") existing = undefined;
      if (existing && existing.computed?.op === "recode" && existing.computed.source !== item.name) {
        target = uniqueName(newMeta, target);
        existing = undefined;
      }
      if (!existing) {
        existing = newVariable(target, { dtype: "integer" });
        insertAfter(newMeta, existing, item.name);
        byName = byNameMap(newMeta);
      }
      existing.label = `${item.name} correct`;
      existing.question_text = item.question_text;
      existing.role = "test_item";
      existing.level = "nominal";
      existing.value_labels = [
        { value: 0, label: "Incorrect" },
        { value: 1, label: "Correct" },
      ];
      existing.computed = defn;
      scoredNames.push(target);
      byName = byNameMap(newMeta);
    }
    const totalNameReq = (p.total_name || "").trim();
    const prefix = commonPrefix(items);
    const defaultTotal = prefix ? `${prefix}_total` : "test_total";
    let total = byNameMap(newMeta).get(totalNameReq || defaultTotal);
    if (total && total.computed?.op !== "scale_sum") {
      if (totalNameReq) throw rpcError(-32003, `There is already a variable called '${totalNameReq}'. Choose another name.`, "InvalidParams");
      total = undefined;
    }
    if (!total) {
      const tname = totalNameReq || uniqueName(newMeta, defaultTotal);
      total = newVariable(tname, { role: "test_total", level: "continuous", dtype: "float" });
      const last = scoredNames.reduce((a, b) => (byNameMap(newMeta).get(b)!.display_order > byNameMap(newMeta).get(a)!.display_order ? b : a));
      insertAfter(newMeta, total, last);
    }
    total.role = "test_total";
    total.level = "continuous";
    total.label = p.total_label || `${prefix || "Test"} total (number correct)`;
    total.question_text = `Number of correct answers across ${scoredNames.length} questions`;
    total.computed = { op: "scale_sum", items: scoredNames as [string, ...string[]], min_items: 1, scale_id: null };

    return this.commitEdit(ds, newMeta, warns, `Scored ${scoredNames.length} test questions with the answer key`);
  }

  parseAnswerKey(p: { path: string }): { entries: AnswerKeyEntry[]; warnings: EditWarning[] } {
    const entries = answerKeyForPath(p.path);
    if (!entries) throw rpcError(-32001, `Unsupported or unreadable file: ${baseName(p.path)}`, "FileUnreadable");
    return { entries, warnings: [] };
  }

  computedPreview(p: ComputedPreviewParams): ComputedPreviewResult {
    const ds = this.getDataset(p.dataset_id);
    const meta = clone(ds.meta);
    checkDefinition(meta, p.definition);
    const { dtype, values, warns } = evaluateDefinition(ds, meta, p.definition);
    const n = Math.min(10, ds.nRows);
    const nValid = values.filter((v) => v !== null).length;
    return {
      snapshot_id: ds.meta.snapshot_id,
      dtype,
      row_ids: Array.from({ length: n }, (_, i) => i),
      values: values.slice(0, n),
      n_valid: nValid,
      n_missing: values.length - nValid,
      warnings: dedupeWarns(warns),
    };
  }

  addComputed(p: ComputedAddParams): DatasetEditResult {
    const ds = this.getDataset(p.dataset_id);
    this.checkStale(ds, p.snapshot_id);
    const newMeta = clone(ds.meta);
    checkNewName(newMeta, p.name.trim());
    const defn = p.definition;
    checkDefinition(newMeta, defn);
    const v = computedVariable(newMeta, p);
    const byName = byNameMap(newMeta);
    const anchor = dependenciesOf(defn).reduce((a, b) => (byName.get(b)!.display_order > byName.get(a)!.display_order ? b : a));
    insertAfter(newMeta, v, anchor);
    return this.commitEdit(ds, newMeta, [], `Added ${v.name}`);
  }

  removeComputed(p: ComputedRemoveParams): DatasetEditResult {
    const ds = this.getDataset(p.dataset_id);
    this.checkStale(ds, p.snapshot_id);
    const newMeta = clone(ds.meta);
    const v = byNameMap(newMeta).get(p.name);
    if (!v) throw rpcError(-32003, `There is no variable called '${p.name}'.`, "InvalidParams");
    if (!v.computed) throw rpcError(-32003, `'${v.name}' came from your file, so it can't be removed here.`, "InvalidParams");
    const users = dependents(newMeta, v.name);
    if (users.length) throw rpcError(-32003, `'${v.name}' is used by ${users.join(", ")}. Remove those first.`, "InvalidParams");
    for (const s of newMeta.scales) if (s.score_variable === v.name) s.score_variable = null;
    newMeta.variables = newMeta.variables.filter((x) => x.name !== v.name);
    renumber(newMeta);
    return this.commitEdit(ds, newMeta, [], `Removed ${v.name}`);
  }

  datasetHistory(p: DatasetIdParams): HistoryResult {
    const ds = this.getDataset(p.dataset_id);
    return {
      dataset_id: p.dataset_id,
      current_snapshot_id: ds.meta.snapshot_id,
      cursor: ds.cursor,
      entries: ds.history.map((e) => ({ snapshot_id: e.snapshot_id, label: e.label, timestamp: e.timestamp, restorable: e.meta !== null })),
    };
  }

  restoreSnapshot(p: { dataset_id: string; snapshot_id: string }): RestoreSnapshotResult {
    const ds = this.getDataset(p.dataset_id);
    const idx = ds.history.findIndex((e) => e.snapshot_id === p.snapshot_id);
    if (idx === -1) throw rpcError(-32002, "That version isn't in this dataset's history.", "StaleSnapshot");
    const entry = ds.history[idx];
    if (!entry.meta || !entry.computed) {
      throw rpcError(
        -32002,
        "That earlier version is no longer available to go back to (only the most recent changes of this session can be undone).",
        "StaleSnapshot",
      );
    }
    ds.meta = clone(entry.meta);
    ds.computedCols = clone(entry.computed);
    ds.columns = ds.meta.variables.map((v) => v.name);
    ds.cursor = idx;
    return { dataset_meta: clone(ds.meta) };
  }

  rows(p: DatasetRowsParams): DatasetRowsResult {
    const ds = this.getDataset(p.dataset_id);
    if (p.snapshot_id && p.snapshot_id !== ds.meta.snapshot_id) {
      throw rpcError(-32002, "Stale snapshot", "StaleSnapshot");
    }
    if (p.limit > 2000) throw rpcError(-32003, "limit must be <= 2000", "InvalidParams");
    const columns = p.columns ?? ds.columns;
    let order: number[] | null = null;
    if (p.sort) {
      const { variable, descending } = p.sort;
      order = Array.from({ length: ds.nRows }, (_, i) => i).sort((a, b) => {
        const x = ds.cell(a, variable);
        const y = ds.cell(b, variable);
        const c = x === y ? 0 : x === null ? 1 : y === null ? -1 : x < y ? -1 : 1;
        return descending ? -c : c;
      });
    }
    const end = Math.min(ds.nRows, p.offset + p.limit);
    const rowIds: number[] = [];
    const rows: CellValue[][] = [];
    for (let i = p.offset; i < end; i++) {
      const r = order ? order[i] : i;
      rowIds.push(r);
      rows.push(columns.map((c) => ds.cell(r, c)));
    }
    return { snapshot_id: ds.meta.snapshot_id, offset: p.offset, total_rows: ds.nRows, columns, row_ids: rowIds, rows };
  }

  missing(p: DatasetIdParams): DatasetMissingSummaryResult {
    const ds = this.getDataset(p.dataset_id);
    return { snapshot_id: ds.meta.snapshot_id, missing_summary: clone(ds.meta.missing_summary) };
  }

  private registerProjectDataset(project: ProjectFile) {
    const meta = project.dataset_meta;
    if (!meta || this.datasets.has(meta.dataset_id)) return;
    const seed = strHash(meta.dataset_id);
    const baseCell = (r: number, col: string): CellValue => {
      const ci = meta.variables.findIndex((v) => v.name === col);
      const v = meta.variables[ci];
      if (!v || r >= meta.n_rows) return null;
      const u = hash32(seed, r, ci);
      if (u < 0.04) return null;
      if (v.value_labels.length) return v.value_labels[Math.floor(u * v.value_labels.length) % v.value_labels.length].value;
      if (v.dtype === "integer") return Math.floor(u * 100);
      if (v.dtype === "float") return Math.round(u * 1000) / 10;
      if (v.dtype === "boolean") return u > 0.5;
      return `${v.name}_${r + 1}`;
    };
    // Mirrors the real engine: a loaded snapshot's data (incl. computed columns) is trusted as
    // saved, not recomputed (recompute only runs after an edit RPC). Kept as a synthetic base
    // column here since there's no parquet to read the already-computed values from.
    const ds = this.makeDatasetState(meta, meta.n_rows, baseCell);
    this.datasets.set(meta.dataset_id, ds);
    this.pushHistory(ds, "Opened project");
  }

  save(p: ProjectSaveParams): ProjectSaveResult {
    const project = clone(p.project);
    if (project.dataset_meta) {
      const ds = this.datasets.get(project.dataset_meta.dataset_id);
      if (ds) project.dataset_meta = clone(ds.meta);
    }
    project.data_path = project.dataset_meta ? "data/dataset.parquet" : null;
    project.modified_at = nowIso();
    this.saved.set(p.path, { project, savedAt: project.modified_at });
    for (const [k, a] of this.autosaves) if (a.project.project_id === project.project_id) this.autosaves.delete(k);
    return { path: p.path, saved_at: project.modified_at, size_bytes: 4096 + (project.dataset_meta?.n_rows ?? 0) * 64, project: clone(project) };
  }

  load(p: ProjectLoadParams): ProjectLoadResult {
    const auto = this.autosaves.get(p.path);
    if (auto) {
      this.registerProjectDataset(auto.project);
      return { project: clone(auto.project), is_autosave: true, autosave_marker: clone(auto.marker) };
    }
    const s = this.saved.get(p.path);
    if (!s) throw rpcError(-32001, `Cannot open ${baseName(p.path)}`, "FileUnreadable");
    this.registerProjectDataset(s.project);
    return { project: clone(s.project), is_autosave: false, autosave_marker: null };
  }

  autosave(p: ProjectAutosaveParams): ProjectAutosaveResult {
    const path = `${p.autosave_dir}/${p.project.project_id}.statly`;
    const saved_at = nowIso();
    const project = clone(p.project);
    if (project.dataset_meta) {
      const ds = this.datasets.get(project.dataset_meta.dataset_id);
      if (ds) project.dataset_meta = clone(ds.meta);
    }
    this.autosaves.set(path, { project, marker: { schema_version: 1, project_id: project.project_id, original_path: p.original_path, saved_at } });
    return { autosave_path: path, saved_at };
  }

  recoverable(p: ProjectRecoverableParams): ProjectRecoverableResult {
    const autosaves = [...this.autosaves.entries()]
      .filter(([path]) => path.startsWith(p.autosave_dir))
      .filter(([, a]) => {
        const orig = a.marker.original_path && this.saved.get(a.marker.original_path);
        return !orig || orig.savedAt < a.marker.saved_at;
      })
      .map(([autosave_path, a]) => ({ autosave_path, marker: clone(a.marker) }));
    return { autosaves };
  }

  discard(p: ProjectDiscardAutosaveParams): OkResult {
    this.autosaves.delete(p.autosave_path);
    return { ok: true };
  }
}
