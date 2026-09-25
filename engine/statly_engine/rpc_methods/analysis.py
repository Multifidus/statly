"""analysis.* RPC handlers (Phase 3): run a registered analysis on the current dataset snapshot.

- `analysis.run`  params AnalysisRequest -> AnalysisResult. The request's snapshot_id must equal the
  dataset's current snapshot (else -32002 StaleOrUnknown); invalid variable choices -> -32003.
- `analysis.list` params {} -> {"analyses": [{analysis_id, label, layouts: [{name, roles}], options}]}.
The analysis itself is pure: stats.registry.run(df, request, meta).
"""

from __future__ import annotations

from statly_engine.contracts import AnalysisRequest, AnalysisResult
from statly_engine.data.store import DatasetStore
from statly_engine.errors import StaleOrUnknown
from statly_engine.rpc_methods import rpc_method
from statly_engine.stats import registry


@rpc_method(AnalysisRequest, AnalysisResult)
def run(store: DatasetStore, params: dict) -> dict:
    request = AnalysisRequest.model_validate(params)
    state = store.get(request.dataset_id)
    if request.snapshot_id != state.meta["snapshot_id"]:
        raise StaleOrUnknown("The data changed since this analysis was set up; please run it again.",
                             snapshot_id=state.meta["snapshot_id"])
    return registry.run(state.df, request, state.meta)


def list_(store: DatasetStore, params: dict) -> dict:
    return {"analyses": registry.describe_all()}


METHODS = {"analysis.run": run, "analysis.list": list_}
