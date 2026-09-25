/**
 * Typed wrappers for every engine RPC method (contracts/README.md "Phase 1 RPC methods").
 * `engine.ts` stays the transport; this module only adds types and a swappable transport
 * so tests and the mock engine (VITE_STATLY_MOCK=1) can stand in for the Tauri sidecar.
 */
import { engineCall, type EngineError, type EngineInfo, type PingResult } from "@/lib/engine";
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
import type { AnalysisRequest, AnalysisResult } from "@/contracts";

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

/** Phase 1 application error codes (contracts/README.md). */
export const RpcErrorCode = {
  FileUnreadable: -32001,
  StaleOrUnknown: -32002,
  InvalidParams: -32003,
  ProjectIncompatible: -32004,
} as const;

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
};

export type Rpc = typeof rpc;

function isEngineError(e: unknown): e is EngineError {
  return !!e && typeof e === "object" && "kind" in e;
}

/** Plain-language, one-sentence message for any error thrown by an `rpc.*` call. */
export function describeRpcError(e: unknown): string {
  if (!isEngineError(e)) return "Something went wrong. Please try again.";
  if (e.kind === "rpc") {
    switch (e.code) {
      case RpcErrorCode.FileUnreadable:
        return "Statly couldn't read that file. Check that it is a CSV or Excel (.xlsx) file and that it isn't open in another program.";
      case RpcErrorCode.StaleOrUnknown:
        return "Your data changed while this was loading. Please try that step again.";
      case RpcErrorCode.InvalidParams:
        return "Statly sent the engine something it didn't expect. Please try again, and report this if it keeps happening.";
      case RpcErrorCode.ProjectIncompatible:
        return "This project was saved by a newer version of Statly. Update Statly to open it.";
      default:
        return "The statistics engine ran into a problem with that request.";
    }
  }
  if (e.kind === "timeout") return "The statistics engine took too long to answer. Please try again.";
  return "Statly couldn't talk to its statistics engine.";
}
