"""Shared helpers for chart-data computation: shelf access, grouping keys, JSON-safe numbers."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from statly_engine.errors import InvalidParams
from statly_engine.stats import prep

# Grouping shelves -> row field names used by every chart type (and by the app's spec compiler).
GROUP_FIELDS = {"color": "color", "facet": "facet", "facet2": "facet2"}


def num(x) -> float | None:
    """JSON-safe float (NaN/inf -> None)."""
    if x is None:
        return None
    x = float(x)
    return x if math.isfinite(x) else None


def fields(spec: dict, shelf: str) -> list[str]:
    return [f["variable"] for f in spec["shelves"].get(shelf) or []]


def aggregate_of(spec: dict, shelf: str, i: int = 0) -> str:
    items = spec["shelves"].get(shelf) or []
    return items[i]["aggregate"] if i < len(items) else "none"


def cust(spec: dict, key: str, default=None):
    v = (spec.get("customization") or {}).get(key)
    return default if v is None else v


def need(cond: bool, message: str) -> None:
    if not cond:
        raise InvalidParams(message)


def category_labels(df: pd.DataFrame, name: str, meta: dict | None) -> tuple[pd.Series, list[str]]:
    """Display-label Series (None = missing) and the ordered list of labels present."""
    raw = prep.categorical(df, name, meta)
    order = prep.level_order(raw, name, meta)
    labels_in_order = [prep.value_label(meta, name, v) for v in order]
    out = raw.map(lambda v: None if v is None else prep.value_label(meta, name, v))
    return out, list(dict.fromkeys(labels_in_order))


def group_frame(df: pd.DataFrame, spec: dict, meta: dict | None, extra: dict[str, str] | None = None,
                skip: tuple[str, ...] = ()) -> tuple[pd.DataFrame, dict[str, list[str]], dict[str, str]]:
    """Label columns for grouping keys: color, facet, facet2 (+ `extra` {field: variable}).

    Returns (keys frame aligned to df.index, level order per field, variable label per field).
    """
    wanted: dict[str, str] = dict(extra or {})
    color = fields(spec, "color")
    facet = fields(spec, "facet")
    if color and "color" not in skip:
        wanted["color"] = color[0]
    if facet and "facet" not in skip:
        wanted["facet"] = facet[0]
    if len(facet) > 1 and "facet2" not in skip:
        wanted["facet2"] = facet[1]
    keys = pd.DataFrame(index=df.index)
    levels: dict[str, list[str]] = {}
    labels: dict[str, str] = {}
    for fld, var in wanted.items():
        s, order = category_labels(df, var, meta)
        keys[fld] = s
        levels[fld] = order
        labels[fld] = prep.label(meta, var)
    return keys, levels, labels


def iter_groups(keys: pd.DataFrame, levels: dict[str, list[str]]):
    """Yield ({field: label}, boolean mask) for every combination present, in level order."""
    cols = list(keys.columns)
    if not cols:
        yield {}, np.ones(len(keys), dtype=bool)
        return
    complete = keys.notna().all(axis=1).to_numpy()
    combos = keys[complete].drop_duplicates()
    rank = {c: {lv: i for i, lv in enumerate(levels[c])} for c in cols}
    tuples = sorted((tuple(r) for r in combos.itertuples(index=False, name=None)),
                    key=lambda t: tuple(rank[c].get(v, 10 ** 6) for c, v in zip(cols, t)))
    for t in tuples:
        mask = complete.copy()
        for c, v in zip(cols, t):
            mask &= (keys[c] == v).to_numpy()
        yield dict(zip(cols, t)), mask


def complete_mask(keys: pd.DataFrame) -> np.ndarray:
    return keys.notna().all(axis=1).to_numpy() if len(keys.columns) else np.ones(len(keys), dtype=bool)
