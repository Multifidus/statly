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
  RowFilter,
  StackConfig,
  VariableMissingSummary,
  VariableSchema,
} from "@/contracts";
import type { EngineError } from "@/lib/engine";
import type { Transport } from "@/lib/rpc";
import { MOCK_EXAMPLE_PROJECT_PATH, shapeForPath, type FileShape } from "./shapes";

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

interface DatasetState {
  meta: DatasetMeta;
  nRows: number;
  columns: string[];
  cell: (r: number, col: string) => CellValue;
}

function stageFile(path: string, sheet: string | null, idx: number): StagedFile {
  const shape = shapeForPath(path, sheet);
  if (!shape) {
    throw rpcError(-32001, `Unsupported or unreadable file: ${baseName(path)}`, "FileUnreadable");
  }
  const fileId = `file_${idx + 1}_${(strHash(path) >>> 0).toString(36)}`;
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

function missingSummary(ds: Omit<DatasetState, "meta">, vars: VariableSchema[]): VariableMissingSummary[] {
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
  ): DatasetState {
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
    const varByName = new Map(variables.map((v) => [v.name, v]));
    const outByName = new Map(outs.map((o) => [o.name, o]));

    const cell = (r: number, col: string): CellValue => {
      const row = rowIndex[r];
      if (!row) return null;
      if (stack && col === stack.time_variable) return row.level;
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

  importDataset(p: DatasetImportParams): DatasetResult {
    const staged = this.previews.get(p.preview_id);
    if (!staged) throw rpcError(-32002, `Unknown preview_id ${p.preview_id}`, "StalePreview");
    const ds = this.build(staged, p.files, p.row_filters, p.variables, p.stack, this.nextId("ds"));
    this.datasets.set(ds.meta.dataset_id, ds);
    return { dataset_meta: clone(ds.meta) };
  }

  stack(p: DatasetStackParams): DatasetResult {
    // Mock simplification: the appended files replace nothing; they are appended as new levels.
    const ds = this.getDataset(p.dataset_id);
    const staged = this.previews.get(p.preview_id);
    if (!staged) throw rpcError(-32002, `Unknown preview_id ${p.preview_id}`, "StalePreview");
    const add = this.build(staged, p.files, p.row_filters, p.variables, p.stack, ds.meta.dataset_id);
    const nOld = ds.nRows;
    const cell = (r: number, col: string) => (r < nOld ? ds.cell(r, col) : add.cell(r - nOld, col));
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
    const next = { meta, nRows, columns: ds.columns, cell };
    meta.missing_summary = missingSummary(next, meta.variables);
    this.datasets.set(meta.dataset_id, next);
    return { dataset_meta: clone(meta) };
  }

  link(p: DatasetLinkParams): DatasetLinkResult {
    const ds = this.getDataset(p.dataset_id);
    if (p.mode === "aggregate") {
      ds.meta = { ...ds.meta, snapshot_id: this.nextId("snap"), link: { mode: "aggregate", id_variable: null, normalization: null, counts: null } };
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
    const cell = (r: number, col: string): CellValue => {
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
    this.datasets.set(meta.dataset_id, { meta, nRows: meta.n_rows, columns: meta.variables.map((v) => v.name), cell });
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
