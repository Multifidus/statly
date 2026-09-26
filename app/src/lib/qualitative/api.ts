/**
 * Typed wrappers for the Phase 9 `tags.*` and `export.qualitative` engine methods. Uses the
 * shared swappable transport from `@/lib/rpc`, so the mock engine and tests stand in as usual.
 */
import { getTransport } from "@/lib/rpc";
import type {
  ExportQualitativeParams,
  ExportQualitativeResult,
  ResponsesParams,
  ResponsesResult,
  SummaryResult,
  Tag,
  TagCodebook,
  TagSpec,
  ToVariablesResult,
} from "./types";

const call = <T>(method: string, params: object) => getTransport().call<T>(method, params);

export const qualRpc = {
  codebook: (dataset_id: string) => call<{ codebook: TagCodebook }>("tags.codebook.get", { dataset_id }),
  upsertTag: (dataset_id: string, tag: TagSpec) =>
    call<{ codebook: TagCodebook; tag: Tag }>("tags.codebook.upsert", { dataset_id, tag }),
  deleteTag: (dataset_id: string, tag_id: string) =>
    call<{ codebook: TagCodebook }>("tags.codebook.delete", { dataset_id, tag_id }),
  apply: (p: { dataset_id: string; row_id: number; variable: string; tag_ids: string[] }) =>
    call<{ row_id: number; variable: string; tag_ids: string[] }>("tags.apply", p),
  responses: (p: ResponsesParams) => call<ResponsesResult>("tags.responses", p),
  summary: (p: { dataset_id: string; variable: string; by?: string | null }) => call<SummaryResult>("tags.summary", p),
  toVariables: (p: { dataset_id: string; snapshot_id?: string | null; variable: string; tag_ids?: string[] | null }) =>
    call<ToVariablesResult>("tags.to_variables", p),
  exportQualitative: (p: ExportQualitativeParams) => call<ExportQualitativeResult>("export.qualitative", p),
};
