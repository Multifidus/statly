"""Data access for analyses: subsetting, typed columns, level ordering, labels (SPEC §5.5).

Missing data: blank cells and the variable's declared missing codes (VariableSchema.missing_codes)
are both missing. Analyses use all available data per analysis (pairwise); paired designs use
complete cases on the variables involved and report the counts.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from statly_engine.data.missing import coded_mask
from statly_engine.errors import InvalidParams


def variable_meta(meta: dict | None, name: str) -> dict | None:
    if not meta:
        return None
    for v in meta.get("variables", []):
        if v["name"] == name:
            return v
    return None


def label(meta: dict | None, name: str) -> str:
    """Display name: the variable's label if set, else its name."""
    v = variable_meta(meta, name)
    return (v or {}).get("label") or name


def _is_missing(series: pd.Series, meta: dict | None, name: str) -> pd.Series:
    mask = series.isna()
    v = variable_meta(meta, name)
    if v and v.get("missing_codes"):
        mask = mask | coded_mask(series, v["missing_codes"]).fillna(False).astype(bool)
    return mask.astype(bool)


def require(df: pd.DataFrame, names: list[str]) -> None:
    unknown = [n for n in names if n not in df.columns]
    if unknown:
        raise InvalidParams(f"These variables are not in the dataset: {', '.join(unknown)}.")


def numeric(df: pd.DataFrame, name: str, meta: dict | None = None) -> pd.Series:
    """float64 Series aligned to df.index, NaN = missing. Non-numeric storage -> InvalidParams."""
    require(df, [name])
    col = df[name]
    v = variable_meta(meta, name)
    if (v and v.get("dtype") not in ("integer", "float", "boolean")) or (
            not v and not (pd.api.types.is_numeric_dtype(col) or pd.api.types.is_bool_dtype(col))):
        raise InvalidParams(f"'{label(meta, name)}' holds text, not numbers, so it can't be used as a score here.")
    arr = col.to_numpy(dtype="float64", na_value=np.nan).copy()
    arr[_is_missing(col, meta, name).to_numpy()] = np.nan
    return pd.Series(arr, index=df.index, name=name)


def categorical(df: pd.DataFrame, name: str, meta: dict | None = None) -> pd.Series:
    """object Series of level values (None = missing); numbers stay numbers."""
    require(df, [name])
    col = df[name]
    miss = _is_missing(col, meta, name).to_numpy()
    vals = [None if m or x is None or x is pd.NA or (isinstance(x, float) and np.isnan(x))
            else (x.item() if hasattr(x, "item") else x) for x, m in zip(col.astype(object).tolist(), miss)]
    return pd.Series(vals, index=df.index, name=name, dtype=object)


def level_order(values: pd.Series, name: str, meta: dict | None = None, explicit: list | None = None) -> list:
    """Category order: explicit option > value_labels order > sorted observed values."""
    present = [v for v in pd.unique(values.dropna()) if v is not None]
    if explicit:
        missing = [e for e in explicit if not any(_same(e, p) for p in present)]
        if missing:
            raise InvalidParams(f"'{label(meta, name)}' has no rows with the value(s): "
                                f"{', '.join(map(str, missing))}.")
        return [next(p for p in present if _same(e, p)) for e in explicit]
    v = variable_meta(meta, name)
    ordered = []
    if v and v.get("value_labels"):
        for vl in v["value_labels"]:
            for p in present:
                if _same(vl["value"], p) and p not in ordered:
                    ordered.append(p)
    rest = [p for p in present if p not in ordered]
    try:
        rest = sorted(rest)
    except TypeError:
        rest = sorted(rest, key=str)
    return ordered + rest


def value_label(meta: dict | None, name: str, value) -> str:
    v = variable_meta(meta, name)
    if v:
        for vl in v.get("value_labels") or []:
            if _same(vl["value"], value):
                return vl["label"]
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _same(a, b) -> bool:
    if a is None or b is None:
        return a is b
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b or str(a).lower() == str(b).lower()
    try:
        return float(a) == float(b)
    except (TypeError, ValueError):
        return str(a) == str(b)


def apply_subset(df: pd.DataFrame, subset: list, meta: dict | None = None) -> pd.DataFrame:
    """AND of SubsetConditions (op in / not_in). Missing values never match 'in'."""
    if not subset:
        return df
    keep = np.ones(len(df), dtype=bool)
    for cond in subset:
        c = cond if isinstance(cond, dict) else cond.model_dump(mode="json")
        require(df, [c["variable"]])
        vals = categorical(df, c["variable"], meta)
        hit = vals.map(lambda x: x is not None and any(_same(x, w) for w in c["values"])).to_numpy(bool)
        keep &= hit if c["op"] == "in" else ~hit
    return df.loc[keep]
