"""charts.* RPC handlers (Phase 7, SPEC §10.2).

- `charts.data` params {dataset_id, snapshot_id, spec: ChartSpec} -> {rows: object[], meta: object}.
  Dataset charts need the current snapshot (else -32002); scree / cfa_path read the stored Test Log
  result named by `spec.source.test_log_entry_id` (ids may then be null). Bad shelves -> -32003.
"""

from __future__ import annotations

import json

from pydantic import BaseModel, ConfigDict

from statly_engine import charts
from statly_engine.contracts import ChartSpec
from statly_engine.data.store import DatasetStore
from statly_engine.errors import InvalidParams, StaleOrUnknown
from statly_engine.rpc_methods import rpc_method


class ChartsDataParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dataset_id: str | None = None
    snapshot_id: str | None = None
    spec: ChartSpec


class ChartsDataResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rows: list[dict]
    meta: dict


@rpc_method(ChartsDataParams, ChartsDataResult)
def data(store: DatasetStore, params: dict) -> dict:
    spec = ChartSpec.model_validate(params["spec"]).model_dump(mode="json")
    if spec["chart_type"] in charts.RESULT_CHARTS:
        rid = spec["source"].get("test_log_entry_id")
        if spec["source"]["kind"] != "analysis" or not rid:
            raise InvalidParams("Pick a saved factor analysis from the Test Log for this chart.")
        raw = store.results.get(rid)
        if raw is None:
            raise StaleOrUnknown("That analysis result isn't stored in this project.", request_id=rid)
        return charts.compute_from_result(json.loads(raw), spec)
    if not params.get("dataset_id"):
        raise InvalidParams("Open a dataset to draw this chart.")
    state = store.get(params["dataset_id"])
    if params.get("snapshot_id") != state.meta["snapshot_id"]:
        raise StaleOrUnknown("The data changed since this chart was set up; please try again.",
                             snapshot_id=state.meta["snapshot_id"])
    return charts.compute(state.df, spec, state.meta)


METHODS = {"charts.data": data}
