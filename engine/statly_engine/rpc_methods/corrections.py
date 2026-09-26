"""corrections.* RPC handlers (Phase 6, SPEC §9).

- `corrections.adjust` params {p_values: (number|null)[], method: none|bonferroni|holm|fdr_bh}
  -> {adjusted: (number|null)[]}. Pure; matches R `p.adjust`. The app calls it whenever the user
  picks or changes a Test Log family's method; nothing is ever corrected automatically.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from statly_engine.data.store import DatasetStore
from statly_engine.errors import InvalidParams
from statly_engine.rpc_methods import rpc_method
from statly_engine.stats.corrections import p_adjust


class CorrectionsAdjustParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    p_values: list[float | None]
    method: Literal["none", "bonferroni", "holm", "fdr_bh"]


class CorrectionsAdjustResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    adjusted: list[float | None]


@rpc_method(CorrectionsAdjustParams, CorrectionsAdjustResult)
def adjust(store: DatasetStore, params: dict) -> dict:
    try:
        return {"adjusted": p_adjust(params["p_values"], params["method"])}
    except ValueError as exc:
        raise InvalidParams(str(exc)) from exc


METHODS = {"corrections.adjust": adjust}
