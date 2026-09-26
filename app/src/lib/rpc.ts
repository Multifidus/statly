/**
 * Typed wrappers for every engine RPC method (contracts/README.md "Phase 1 RPC methods").
 * `engine.ts` stays the transport; this module only adds types and a swappable transport
 * so tests and the mock engine (VITE_STATLY_MOCK=1) can stand in for the Tauri sidecar.
 */
import { engineCall, type EngineInfo, type PingResult } from "@/lib/engine";
import { describeError, RpcErrorCode } from "@/lib/errors";
import type {
  DatasetIdParams,
  DatasetImportParams,
  DatasetImportPreviewParams,
  DatasetImportPreviewResult,
  DatasetLinkParams,
  DatasetLinkResult,
  DatasetMissingSummaryResult,
  DatasetResult,
  DatasetRowsParams,
  DatasetRowsResult,
  DatasetStackParams,
  OkResult,
  ProjectAutosaveParams,
  ProjectAutosaveResult,
  ProjectDiscardAutosaveParams,
  ProjectLoadParams,
  ProjectLoadResult,
  ProjectRecoverableParams,
  ProjectRecoverableResult,
  ProjectSaveParams,
  ProjectSaveResult,
} from "@/contracts";
import type {
  ComputedAddParams,
  ComputedPreviewParams,
  ComputedPreviewResult,
  ComputedRemoveParams,
  DatasetEditResult,
  HistoryResult,
  ItemsScoreParams,
  ParseAnswerKeyResult,
  RestoreSnapshotResult,
  ScalesDeleteParams,
  ScalesUpsertParams,
  VariablesUpdateParams,
} from "@/lib/variablesRpc";
import type {
  AdvisorAnswerParams,
  AdvisorPath,
  AdvisorStartParams,
  AdvisorStep,
  AnalysisListResult,
} from "@/lib/analysisRpc";
import type { AnalysisRequest, AnalysisResult, ApaTable, CorrectionMethod, TestFamily, TestLogEntry } from "@/contracts";

/** Phase 8 (docs/PROTOCOL.md "Phase 8 methods", SPEC §10.3): report/data/codebook/test-log exports. */
export interface ExportChart {
  request_id: string;
  png_base64: string;
  title?: string | null;
  note?: string | null;
}
export interface ExportInclude {
  tables?: boolean;
  sentences?: boolean;
  assumptions?: boolean;
  charts?: boolean;
}
export interface ExportReportParams {
  title: string;
  author?: string | null;
  results: AnalysisResult[];
  include?: ExportInclude;
  charts?: ExportChart[];
  test_log?: TestLogEntry[];
  test_families?: TestFamily[];
  format: "docx" | "pdf";
  path: string;
  overwrite?: boolean;
}
export interface ExportWrittenResult {
  path: string;
  bytes: number;
}
export interface ExportTableHtmlResult {
  html: string;
  plain_text: string;
}
export interface ExportDataParams {
  dataset_id: string;
  format: "xlsx" | "csv";
  path: string;
  include_metadata_columns?: boolean;
  options?: { label_row?: boolean; blank_missing_codes?: boolean; exclude_pii?: boolean };
  overwrite?: boolean;
}
export interface ExportDataResult extends ExportWrittenResult {
  snapshot_id: string;
  n_rows: number;
  n_columns: number;
  pii_columns: string[];
}
export interface ExportCodebookParams {
  dataset_id: string;
  format: "xlsx" | "docx";
  path: string;
  overwrite?: boolean;
}
export interface ExportTestLogParams {
  entries: TestLogEntry[];
  format: "xlsx" | "csv" | "docx";
  path: string;
  overwrite?: boolean;
}

/** Phase 6 (docs/PROTOCOL.md "Phase 6 methods"): Test Log results and family corrections. */
export interface ResultsPutResult {
  ok: boolean;
  result_path: string;
}
export interface CorrectionsAdjustParams {
  p_values: (number | null)[];
  method: CorrectionMethod;
}

/** Anything that can answer a JSON-RPC method call. Rejects with an `EngineError`. */
export interface Transport {
  call<T>(method: string, params: object): Promise<T>;
}

export const tauriTransport: Transport = {
  call: <T>(method: string, params: object) =>
    engineCall<T>(method, params as Record<string, unknown>),
};

let transport: Transport = tauriTransport;

export function setTransport(t: Transport) {
  transport = t;
}

export function getTransport(): Transport {
  return transport;
}

const call = <T>(method: string, params: object = {}) => transport.call<T>(method, params);

/** Phase 1 application error codes (contracts/README.md). Defined in `@/lib/errors`
 * (the single error-mapping module) and re-exported here since most call sites import it
 * alongside `rpc`. */
export { RpcErrorCode };

export const rpc = {
  ping: () => call<PingResult>("ping"),
  engineInfo: () => call<EngineInfo>("engine.info"),

  importPreview: (p: DatasetImportPreviewParams) =>
    call<DatasetImportPreviewResult>("dataset.import_preview", p),
  importDataset: (p: DatasetImportParams) => call<DatasetResult>("dataset.import", p),
  stack: (p: DatasetStackParams) => call<DatasetResult>("dataset.stack", p),
  link: (p: DatasetLinkParams) => call<DatasetLinkResult>("dataset.link", p),
  rows: (p: DatasetRowsParams) => call<DatasetRowsResult>("dataset.rows", p),
  missingSummary: (p: DatasetIdParams) =>
    call<DatasetMissingSummaryResult>("dataset.missing_summary", p),

  saveProject: (p: ProjectSaveParams) => call<ProjectSaveResult>("project.save", p),
  loadProject: (p: ProjectLoadParams) => call<ProjectLoadResult>("project.load", p),
  autosave: (p: ProjectAutosaveParams) => call<ProjectAutosaveResult>("project.autosave", p),
  recoverable: (p: ProjectRecoverableParams) =>
    call<ProjectRecoverableResult>("project.recoverable", p),
  discardAutosave: (p: ProjectDiscardAutosaveParams) =>
    call<OkResult>("project.discard_autosave", p),

  // Phase 2: Variable Interview (docs/PROTOCOL.md "Phase 2 methods").
  updateVariables: (p: VariablesUpdateParams) => call<DatasetEditResult>("variables.update", p),
  upsertScale: (p: ScalesUpsertParams) => call<DatasetEditResult>("scales.upsert", p),
  deleteScale: (p: ScalesDeleteParams) => call<DatasetEditResult>("scales.delete", p),
  scoreItems: (p: ItemsScoreParams) => call<DatasetEditResult>("items.score", p),
  parseAnswerKey: (p: { path: string }) => call<ParseAnswerKeyResult>("items.parse_answer_key", p),
  previewComputed: (p: ComputedPreviewParams) => call<ComputedPreviewResult>("computed.preview", p),
  addComputed: (p: ComputedAddParams) => call<DatasetEditResult>("computed.add", p),
  removeComputed: (p: ComputedRemoveParams) => call<DatasetEditResult>("computed.remove", p),
  history: (p: DatasetIdParams) => call<HistoryResult>("dataset.history", p),
  restoreSnapshot: (p: { dataset_id: string; snapshot_id: string }) =>
    call<RestoreSnapshotResult>("dataset.restore_snapshot", p),

  // Phase 4: Test Advisor + analyses (docs/PROTOCOL.md, contracts/README.md).
  advisorStart: (p: AdvisorStartParams) => call<AdvisorStep>("advisor.start", p),
  advisorAnswer: (p: AdvisorAnswerParams) => call<AdvisorStep>("advisor.answer", p),
  advisorPaths: () => call<{ paths: AdvisorPath[] }>("advisor.paths", {}),
  analysisList: () => call<AnalysisListResult>("analysis.list", {}),
  analysisRun: (p: AnalysisRequest) => call<AnalysisResult>("analysis.run", p),

  // Phase 6: Test Log results + multiple-comparison corrections (SPEC §9).
  resultsPut: (p: { request_id: string; result: AnalysisResult }) => call<ResultsPutResult>("results.put", p),
  resultsGet: (p: { request_id: string }) => call<{ result: AnalysisResult }>("results.get", p),
  correctionsAdjust: (p: CorrectionsAdjustParams) => call<{ adjusted: (number | null)[] }>("corrections.adjust", p),

  // Phase 8: Exports (docs/PROTOCOL.md "Phase 8 methods", SPEC §10.3).
  exportTableHtml: (p: { apa_table: ApaTable; number?: number | null }) =>
    call<ExportTableHtmlResult>("export.table_html", p),
  exportReport: (p: ExportReportParams) => call<ExportWrittenResult>("export.report", p),
  exportData: (p: ExportDataParams) => call<ExportDataResult>("export.data", p),
  exportCodebook: (p: ExportCodebookParams) => call<ExportWrittenResult>("export.codebook", p),
  exportTestLog: (p: ExportTestLogParams) => call<ExportWrittenResult>("export.test_log", p),
};

export type Rpc = typeof rpc;

/** Plain-language, one-sentence message for any error thrown by an `rpc.*` call.
 * Thin wrapper over `describeError` (the single error mapper) for call sites that only need
 * the body text; use `describeError` directly when a title/details disclosure is also wanted. */
export function describeRpcError(e: unknown): string {
  return describeError(e).body;
}

/** Phase 7: chart builder data (docs/PROTOCOL.md "Phase 7 methods", SPEC §10.2). */
export const chartsRpc = {
  data: (p: import("@/lib/chartbuilder/types").ChartsDataParams) =>
    call<import("@/lib/chartbuilder/types").ChartsDataResult>("charts.data", p),
};
