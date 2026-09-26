"""project.* RPC handlers."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from statly_engine import ENGINE_VERSION
from statly_engine.contracts import AnalysisResult, Rpc
from statly_engine.data import project as proj
from statly_engine.data.store import DatasetStore
from statly_engine.rpc_methods import rpc_method


@rpc_method(Rpc.ProjectSaveParams, Rpc.ProjectSaveResult)
def save(store: DatasetStore, params: dict) -> dict:
    return proj.save(store, params["path"], params["project"], ENGINE_VERSION)


@rpc_method(Rpc.ProjectLoadParams, Rpc.ProjectLoadResult)
def load(store: DatasetStore, params: dict) -> dict:
    return proj.load(store, params["path"])


@rpc_method(Rpc.ProjectAutosaveParams, Rpc.ProjectAutosaveResult)
def autosave(store: DatasetStore, params: dict) -> dict:
    return proj.autosave(store, params["autosave_dir"], params["original_path"], params["project"], ENGINE_VERSION)


@rpc_method(Rpc.ProjectRecoverableParams, Rpc.ProjectRecoverableResult)
def recoverable(store: DatasetStore, params: dict) -> dict:
    return proj.recoverable(params["autosave_dir"])


@rpc_method(Rpc.ProjectDiscardAutosaveParams, Rpc.OkResult)
def discard_autosave(store: DatasetStore, params: dict) -> dict:
    return proj.discard_autosave(store, params["autosave_path"])


# Phase 6: full Test Log results (engine-side models; documented in docs/PROTOCOL.md).
class ResultsPutParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str
    result: AnalysisResult


class ResultsPutResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ok: bool
    result_path: str


class ResultsGetParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str


class ResultsGetResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    result: AnalysisResult


@rpc_method(ResultsPutParams, ResultsPutResult)
def results_put(store: DatasetStore, params: dict) -> dict:
    return proj.put_result(store, params["request_id"], params["result"])


@rpc_method(ResultsGetParams, ResultsGetResult)
def results_get(store: DatasetStore, params: dict) -> dict:
    return proj.get_result(store, params["request_id"])


METHODS = {
    "project.save": save,
    "project.load": load,
    "project.autosave": autosave,
    "project.recoverable": recoverable,
    "project.discard_autosave": discard_autosave,
    "results.put": results_put,
    "results.get": results_get,
}
