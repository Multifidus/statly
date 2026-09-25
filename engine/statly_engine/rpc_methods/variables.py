"""Phase 2 RPC handlers: Variable Interview edits, scales, answer keys, computed variables,
and snapshot history (undo/redo). docs/PROTOCOL.md "Phase 2 methods".

contracts/Rpc.json does not (yet) define these params/results, so the models live here and
are composed from the generated contract types (VariableSchema, DatasetMeta sub-types), so the
same field rules apply. All objects are closed (extra="forbid").
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from statly_engine.contracts import DatasetMeta
from statly_engine.contracts._gen.VariableSchema import (
    ComputedDefinition,
    MeasurementLevel,
    ResponseRange,
    ValueLabel,
    VariableRole,
)
from statly_engine.data import variables as ops
from statly_engine.data.store import DatasetStore
from statly_engine.rpc_methods import rpc_method


class _Closed(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EditWarning(_Closed):
    code: str
    message: str
    variable: str | None


class DatasetEditResult(_Closed):
    dataset_meta: DatasetMeta
    warnings: list[EditWarning]


class _EditParams(_Closed):
    dataset_id: str = Field(min_length=1)
    snapshot_id: str | None = None  # optional stale check


class VariablePatch(_Closed):
    name: str = Field(min_length=1)
    role: VariableRole | None = None
    level: MeasurementLevel | None = None
    label: str | None = None
    question_text: str | None = None
    value_labels: list[ValueLabel] | None = None
    reverse_coded: bool | None = None
    response_range: ResponseRange | None = None
    missing_codes: list[float | str] | None = None
    display_order: int | None = Field(default=None, ge=0)


class VariablesUpdateParams(_EditParams):
    updates: list[VariablePatch] = Field(min_length=1)
    label: str | None = None  # history label override


class ScaleSpec(_Closed):
    id: str | None = None
    name: str = Field(min_length=1)
    items: list[str] = Field(min_length=1)
    scoring_method: Literal["mean", "sum"]
    min_items: int | None = Field(default=None, ge=1)
    score_variable: str | None = None


class ScalesUpsertParams(_EditParams):
    scale: ScaleSpec


class ScalesDeleteParams(_EditParams):
    scale_id: str


class AnswerKeyEntry(_Closed):
    item: str = Field(min_length=1)
    correct: list[float | str] | None


class ItemsScoreParams(_EditParams):
    key: list[AnswerKeyEntry] = Field(min_length=1)
    total_name: str | None = None
    total_label: str | None = None


class ParseAnswerKeyParams(_Closed):
    path: str = Field(min_length=1)


class ParseAnswerKeyResult(_Closed):
    entries: list[AnswerKeyEntry]
    warnings: list[EditWarning]


class ComputedPreviewParams(_Closed):
    dataset_id: str = Field(min_length=1)
    definition: ComputedDefinition


class ComputedPreviewResult(_Closed):
    snapshot_id: str
    dtype: str
    row_ids: list[int]
    values: list[float | str | bool | None]
    n_valid: int
    n_missing: int
    warnings: list[EditWarning]


class ComputedAddParams(_EditParams):
    name: str = Field(min_length=1)
    label: str | None = None
    role: VariableRole | None = None
    level: MeasurementLevel | None = None
    definition: ComputedDefinition


class ComputedRemoveParams(_EditParams):
    name: str = Field(min_length=1)


class DatasetRestoreParams(_Closed):
    dataset_id: str = Field(min_length=1)
    snapshot_id: str = Field(min_length=1)


class DatasetRestoreResult(_Closed):
    dataset_meta: DatasetMeta


class HistoryParams(_Closed):
    dataset_id: str = Field(min_length=1)


class HistoryEntryModel(_Closed):
    snapshot_id: str
    label: str
    timestamp: str
    restorable: bool


class HistoryResult(_Closed):
    dataset_id: str
    current_snapshot_id: str
    cursor: int
    entries: list[HistoryEntryModel]


def _patches(params: dict) -> dict:
    # Keep exactly the keys the app sent (a sent null, e.g. label: null, clears the field).
    return {**params, "updates": [dict(u) for u in params["updates"]]}


@rpc_method(VariablesUpdateParams, DatasetEditResult)
def variables_update(store: DatasetStore, params: dict) -> dict:
    return ops.apply(store, _patches(params), ops.update_variables)


@rpc_method(ScalesUpsertParams, DatasetEditResult)
def scales_upsert(store: DatasetStore, params: dict) -> dict:
    return ops.apply(store, params, ops.upsert_scale)


@rpc_method(ScalesDeleteParams, DatasetEditResult)
def scales_delete(store: DatasetStore, params: dict) -> dict:
    return ops.apply(store, params, ops.delete_scale)


@rpc_method(ItemsScoreParams, DatasetEditResult)
def items_score(store: DatasetStore, params: dict) -> dict:
    return ops.apply(store, params, ops.score_items)


@rpc_method(ParseAnswerKeyParams, ParseAnswerKeyResult)
def items_parse_answer_key(store: DatasetStore, params: dict) -> dict:
    return ops.parse_answer_key(params["path"])


@rpc_method(ComputedPreviewParams, ComputedPreviewResult)
def computed_preview(store: DatasetStore, params: dict) -> dict:
    return ops.preview_computed(store, params)


@rpc_method(ComputedAddParams, DatasetEditResult)
def computed_add(store: DatasetStore, params: dict) -> dict:
    return ops.apply(store, params, ops.add_computed)


@rpc_method(ComputedRemoveParams, DatasetEditResult)
def computed_remove(store: DatasetStore, params: dict) -> dict:
    return ops.apply(store, params, ops.remove_computed)


@rpc_method(DatasetRestoreParams, DatasetRestoreResult)
def restore_snapshot(store: DatasetStore, params: dict) -> dict:
    return {"dataset_meta": store.restore(params["dataset_id"], params["snapshot_id"])}


@rpc_method(HistoryParams, HistoryResult)
def history(store: DatasetStore, params: dict) -> dict:
    return ops.history(store, params["dataset_id"])


METHODS = {
    "variables.update": variables_update,
    "scales.upsert": scales_upsert,
    "scales.delete": scales_delete,
    "items.score": items_score,
    "items.parse_answer_key": items_parse_answer_key,
    "computed.preview": computed_preview,
    "computed.add": computed_add,
    "computed.remove": computed_remove,
    "dataset.restore_snapshot": restore_snapshot,
    "dataset.history": history,
}
