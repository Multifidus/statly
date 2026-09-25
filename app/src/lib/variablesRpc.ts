/**
 * Phase 2 RPC shapes (docs/PROTOCOL.md "Phase 2 methods"). Not yet in contracts/Rpc.json, so they
 * are hand-written here from the generated contract sub-types; keep in sync with
 * engine/statly_engine/rpc_methods/variables.py.
 */
import type {
  CellValue,
  ComputedDefinition,
  DatasetMeta,
  MeasurementLevel,
  ResponseRange,
  ValueLabel,
  VariableRole,
} from "@/contracts";

export interface EditWarning {
  code: string;
  message: string;
  variable: string | null;
}

export interface DatasetEditResult {
  dataset_meta: DatasetMeta;
  warnings: EditWarning[];
}

interface EditParams {
  dataset_id: string;
  /** Optional stale check: rejected with -32002 when not the current snapshot. */
  snapshot_id?: string | null;
}

/** Only the keys present are changed; a sent null clears a nullable field. */
export interface VariablePatch {
  name: string;
  role?: VariableRole;
  level?: MeasurementLevel;
  label?: string | null;
  question_text?: string | null;
  value_labels?: ValueLabel[];
  reverse_coded?: boolean;
  response_range?: ResponseRange | null;
  missing_codes?: (number | string)[];
  display_order?: number;
}

export interface VariablesUpdateParams extends EditParams {
  updates: VariablePatch[];
  /** History label override (e.g. "Variable interview answers"). */
  label?: string | null;
}

export interface ScaleSpec {
  id?: string | null;
  name: string;
  items: string[];
  scoring_method: "mean" | "sum";
  /** Omit for the default (half the items rounded up for mean, all for sum). */
  min_items?: number | null;
  score_variable?: string | null;
}

export interface ScalesUpsertParams extends EditParams {
  scale: ScaleSpec;
}

export interface ScalesDeleteParams extends EditParams {
  scale_id: string;
}

export interface AnswerKeyEntry {
  item: string;
  /** Correct answer(s); null = item is already scored 0/1. */
  correct: (number | string)[] | null;
}

export interface ItemsScoreParams extends EditParams {
  key: AnswerKeyEntry[];
  total_name?: string | null;
  total_label?: string | null;
}

export interface ParseAnswerKeyResult {
  entries: AnswerKeyEntry[];
  warnings: EditWarning[];
}

export interface ComputedPreviewParams {
  dataset_id: string;
  definition: ComputedDefinition;
}

export interface ComputedPreviewResult {
  snapshot_id: string;
  dtype: string;
  row_ids: number[];
  values: CellValue[];
  n_valid: number;
  n_missing: number;
  warnings: EditWarning[];
}

export interface ComputedAddParams extends EditParams {
  name: string;
  label?: string | null;
  role?: VariableRole | null;
  level?: MeasurementLevel | null;
  definition: ComputedDefinition;
}

export interface ComputedRemoveParams extends EditParams {
  name: string;
}

export interface HistoryEntry {
  snapshot_id: string;
  label: string;
  timestamp: string;
  /** False for entries only kept as a label (older ones, or from before the project was opened). */
  restorable: boolean;
}

export interface HistoryResult {
  dataset_id: string;
  current_snapshot_id: string;
  cursor: number;
  entries: HistoryEntry[];
}

export interface RestoreSnapshotResult {
  dataset_meta: DatasetMeta;
}
