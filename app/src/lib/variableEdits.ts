/**
 * Dataset edits from the Variable Interview and the Variables screen. Each call is one engine
 * operation = one undo/redo step. On success the new DatasetMeta becomes current, the project is
 * marked dirty, and the engine's plain-language warnings are returned (and shown).
 */
import type { ComputedDefinition, MeasurementLevel, VariableRole } from "@/contracts";
import { describeRpcError, RpcErrorCode, rpc } from "@/lib/rpc";
import type { AnswerKeyEntry, DatasetEditResult, EditWarning, ScaleSpec, VariablePatch } from "@/lib/variablesRpc";
import { useDatasetStore } from "@/stores/dataset";
import { useHistory } from "@/stores/history";
import { useNotify } from "@/stores/notify";
import { useProjectStore } from "@/stores/project";

export class EditError extends Error {}

/** Plain-language message for a failed edit: the engine's own message when it wrote one for users. */
export function describeEditError(e: unknown): string {
  const err = e as { kind?: string; code?: number; message?: string; data?: { errors?: unknown } };
  // Engine-written explanations carry plain-string errors; contract-validation failures carry
  // pydantic error objects and are not meant for users.
  const errs = err?.data?.errors;
  const plain = !Array.isArray(errs) || errs.every((x) => typeof x === "string");
  if (err?.kind === "rpc" && err.code === RpcErrorCode.InvalidParams && err.message && plain) {
    return err.message;
  }
  return describeRpcError(e);
}

function currentMeta() {
  const meta = useDatasetStore.getState().meta;
  if (!meta) throw new EditError("There is no data to edit yet.");
  return meta;
}

/** Run one edit; throws EditError with a user-facing message on failure. */
export async function runEdit(
  op: (datasetId: string, snapshotId: string) => Promise<DatasetEditResult>,
  opts: { quiet?: boolean } = {},
): Promise<EditWarning[]> {
  const meta = currentMeta();
  let res: DatasetEditResult;
  try {
    res = await op(meta.dataset_id, meta.snapshot_id);
  } catch (e) {
    throw new EditError(describeEditError(e));
  }
  useDatasetStore.getState().setMeta(res.dataset_meta);
  useProjectStore.getState().markDirty();
  await useHistory.getState().refresh();
  if (res.warnings.length && !opts.quiet) useNotify.getState().show(res.warnings.map((w) => w.message).join(" "));
  return res.warnings;
}

export const edits = {
  updateVariables: (updates: VariablePatch[], label?: string, opts?: { quiet?: boolean }) =>
    runEdit((dataset_id, snapshot_id) => rpc.updateVariables({ dataset_id, snapshot_id, updates, label: label ?? null }), opts),
  upsertScale: (scale: ScaleSpec, opts?: { quiet?: boolean }) =>
    runEdit((dataset_id, snapshot_id) => rpc.upsertScale({ dataset_id, snapshot_id, scale }), opts),
  deleteScale: (scaleId: string) =>
    runEdit((dataset_id, snapshot_id) => rpc.deleteScale({ dataset_id, snapshot_id, scale_id: scaleId })),
  scoreItems: (key: AnswerKeyEntry[], totalName?: string | null, opts?: { quiet?: boolean }) =>
    runEdit((dataset_id, snapshot_id) => rpc.scoreItems({ dataset_id, snapshot_id, key, total_name: totalName ?? null }), opts),
  addComputed: (p: { name: string; label?: string | null; role?: VariableRole | null; level?: MeasurementLevel | null; definition: ComputedDefinition }) =>
    runEdit((dataset_id, snapshot_id) => rpc.addComputed({ dataset_id, snapshot_id, ...p })),
  removeComputed: (name: string) =>
    runEdit((dataset_id, snapshot_id) => rpc.removeComputed({ dataset_id, snapshot_id, name })),
};

/** Undo/redo the last dataset edit; marks the project dirty. Returns false when nothing happened. */
export async function undoEdit(): Promise<boolean> {
  return stepHistory(-1);
}

export async function redoEdit(): Promise<boolean> {
  return stepHistory(1);
}

async function stepHistory(dir: -1 | 1): Promise<boolean> {
  const h = useHistory.getState();
  if (dir < 0 ? !h.canUndo() : !h.canRedo()) return false;
  const label = dir < 0 ? h.undoLabel() : h.redoLabel();
  try {
    const ok = await (dir < 0 ? h.undo() : h.redo());
    if (ok) {
      useProjectStore.getState().markDirty();
      if (label) useNotify.getState().show(`${dir < 0 ? "Undid" : "Redid"}: ${label}`);
    }
    return ok;
  } catch (e) {
    useNotify.getState().show(describeEditError(e), "error");
    await useHistory.getState().refresh();
    return false;
  }
}
