"""Phase 1 RPC methods (contracts/README.md). Handlers take (store, params) and
validate params/results against the generated pydantic contract models."""

from __future__ import annotations

import json
from functools import wraps

from pydantic import ValidationError

from statly_engine.errors import InvalidParams


def rpc_method(params_model, result_model):
    def deco(fn):
        @wraps(fn)
        def handler(store, params):
            try:
                params_model.model_validate(params)
            except ValidationError as exc:
                raise InvalidParams(
                    "Statly sent the engine something it didn't expect. Please try again, and report this if it keeps happening.",
                    errors=json.loads(exc.json(include_url=False)),
                ) from exc
            result = fn(store, params)
            result_model.model_validate(result)
            return result
        return handler
    return deco


def session_handlers() -> dict:
    from statly_engine.rpc_methods import advisor, dataset, project
    from statly_engine.rpc_methods import variables  # Phase 2: variables/scales/items/computed/history
    from statly_engine.rpc_methods import analysis  # Phase 3: analysis.run / analysis.list
    from statly_engine.rpc_methods import export  # Phase 8: export.*
    from statly_engine.rpc_methods import corrections  # Phase 6: corrections.adjust
    from statly_engine.rpc_methods import charts  # Phase 7: charts.data
    from statly_engine.rpc_methods import tags  # Phase 9: tags.* (qualitative coding)

    return {**charts.METHODS, **dataset.METHODS,**project.METHODS, **advisor.METHODS, **variables.METHODS, **analysis.METHODS,
            **corrections.METHODS, **export.METHODS, **tags.METHODS}
