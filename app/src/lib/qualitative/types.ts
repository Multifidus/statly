/** Phase 9 (SPEC §11.1) qualitative-coding RPC shapes; mirrors engine/statly_engine/rpc_methods/tags.py. */
import type { CellValue, DatasetMeta, Tag, TagApplication, TagCodebook } from "@/contracts";
import type { EditWarning } from "@/lib/variablesRpc";

export type { Tag, TagApplication, TagCodebook };

export interface TagSpec {
  id?: string | null;
  name: string;
  color?: string | null;
  definition?: string | null;
}

export interface ValueFilter {
  variable: string;
  values: CellValue[];
}

/** "untagged", a tag id, or null for every response. */
export type TagFilter = string | null;

export interface ResponsesParams {
  dataset_id: string;
  variable: string;
  filters?: ValueFilter[];
  search?: string | null;
  tag_filter?: TagFilter;
  context_variables?: string[];
  offset?: number;
  limit?: number;
}

export interface ResponseItem {
  row_id: number;
  text: string;
  /** [start, end) match spans in UTF-16 code units (JavaScript string indices). */
  matches: [number, number][];
  tag_ids: string[];
  context: Record<string, CellValue>;
}

export interface ResponsesResult {
  snapshot_id: string;
  variable: string;
  offset: number;
  /** Responses matching the filters and search. */
  total: number;
  /** Every non-empty response to the variable. */
  total_responses: number;
  items: ResponseItem[];
}

export interface TagCount {
  tag_id: string;
  count: number;
  percent: number | null;
}

export interface GroupCounts {
  value: CellValue;
  label: string;
  n_responses: number;
  counts: TagCount[];
}

export interface SummaryResult {
  snapshot_id: string;
  variable: string;
  n_responses: number;
  n_coded: number;
  n_uncoded: number;
  tags: Tag[];
  overall: TagCount[];
  by: string | null;
  groups: GroupCounts[];
  n_missing_group: number;
}

export interface CreatedVariable {
  tag_id: string;
  variable: string;
  n_yes: number;
  n_no: number;
  n_missing: number;
  updated: boolean;
}

export interface ToVariablesResult {
  dataset_meta: DatasetMeta;
  warnings: EditWarning[];
  created: CreatedVariable[];
}

export interface ExportQualitativeParams {
  dataset_id: string;
  variable: string;
  kind: "responses" | "codebook";
  format: "xlsx" | "docx";
  path: string;
  context_variables?: string[];
  title?: string | null;
  overwrite?: boolean;
}

export interface ExportQualitativeResult {
  path: string;
  bytes: number;
  n_responses: number;
}
