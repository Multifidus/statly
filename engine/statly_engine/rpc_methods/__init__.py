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
                    "The request parameters don't match the contract.",
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

    return {**dataset.METHODS, **project.METHODS, **advisor.METHODS, **variables.METHODS, **analysis.METHODS}
