"""Pure scoring functions for Phase 2 (SPEC §6): reverse-scoring, scale scores,
answer-key scoring, gain scores and recodes.

Every function takes a DataFrame plus variable dicts (VariableSchema) and returns new
arrays; nothing here mutates its inputs. Missing = blank cell or a declared missing code.
Warnings are returned as plain dicts `{code, message, variable}` for the app to show.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from statly_engine.data.linking import normalize_id
from statly_engine.data.missing import coded_mask
from statly_engine.errors import InvalidParams

NUMERIC_DTYPES = ("integer", "float", "boolean")


def warning(code: str, message: str, variable: str | None = None) -> dict:
    return {"code": code, "message": message, "variable": variable}


# ---------------------------------------------------------------------------
# Basic value access
# ---------------------------------------------------------------------------
def valid_mask(col: pd.Series, var: dict) -> np.ndarray:
    """True where a cell holds a real answer (not blank, not a declared missing code)."""
    return (col.notna() & ~coded_mask(col, var.get("missing_codes") or [])).to_numpy(dtype=bool)


def numeric_values(df: pd.DataFrame, var: dict, purpose: str) -> np.ndarray:
    """float64 array with NaN for missing. Text variables are rejected in plain language."""
    if var["dtype"] not in NUMERIC_DTYPES:
        raise InvalidParams(
            f"'{var['name']}' holds text, so it can't be used {purpose}. Choose a variable with numbers, "
            "or confirm its answer codes first.", variable=var["name"])
    col = df[var["name"]]
    x = col.to_numpy(dtype="float64", na_value=np.nan)
    return np.where(valid_mask(col, var), x, np.nan)


def reverse_bounds(df: pd.DataFrame, var: dict) -> tuple[float, float, dict | None]:
    """(min, max) for reverse-scoring: response_range if set, else observed min/max + a warning."""
    rr = var.get("response_range")
    if rr is not None:
        return float(rr["min"]), float(rr["max"]), None
    x = numeric_values(df, var, "as a scale item")
    ok = x[~np.isnan(x)]
    if ok.size == 0:
        return math.nan, math.nan, warning(
            "reverse_no_data", f"'{var['name']}' has no answers, so it could not be reverse-scored.", var["name"])
    lo, hi = float(ok.min()), float(ok.max())
    return lo, hi, warning(
        "reverse_range_observed",
        f"'{var['name']}' has no answer range set, so Statly reversed it using the lowest and highest answers "
        f"people actually gave ({_fmt(lo)} and {_fmt(hi)}). If the scale really runs wider (for example 1 to 5), "
        "set the answer range so reverse-scoring is exact.", var["name"])


def item_scores(df: pd.DataFrame, var: dict) -> tuple[np.ndarray, list[dict]]:
    """An item's values as used in a scale: numeric, missing codes removed, reversed if reverse_coded."""
    x = numeric_values(df, var, "as a scale item")
    warns: list[dict] = []
    if var.get("reverse_coded"):
        lo, hi, w = reverse_bounds(df, var)
        if w:
            warns.append(w)
        x = (lo + hi) - x
    return x, warns


def _fmt(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else f"{x:g}"


# ---------------------------------------------------------------------------
# Scale scores
# ---------------------------------------------------------------------------
def default_min_items(n_items: int, method: str) -> int:
    """SPEC §6 default: a mean needs at least half the items answered (rounded up); a sum needs all."""
    return max(1, math.ceil(n_items / 2)) if method == "mean" else max(1, n_items)


def scale_score(df: pd.DataFrame, by_name: dict[str, dict], items: list[str], op: str,
                min_items: int | None) -> tuple[np.ndarray, list[dict]]:
    """Mean or sum of answered items (reverse-coded items reversed first).

    min_items = None follows the contract: at least one item for a mean, all items for a sum.
    Rows answering fewer than the threshold get a missing score.
    """
    warns: list[dict] = []
    cols = []
    for name in items:
        if name not in by_name:
            raise InvalidParams(f"The scale refers to '{name}', which is not in the dataset.", variable=name)
        x, w = item_scores(df, by_name[name])
        warns += w
        cols.append(x)
    if not cols:
        raise InvalidParams("A scale needs at least one item.")
    m = np.column_stack(cols)
    answered = (~np.isnan(m)).sum(axis=1)
    threshold = min_items if min_items is not None else (1 if op == "scale_mean" else len(items))
    with np.errstate(invalid="ignore"):
        if op == "scale_mean":
            with np.errstate(all="ignore"):
                total = np.nansum(m, axis=1)
                out = np.where(answered > 0, total / np.maximum(answered, 1), np.nan)
        else:
            out = np.nansum(m, axis=1)
    out = np.where(answered >= threshold, out, np.nan)
    return out.astype("float64"), warns


# ---------------------------------------------------------------------------
# Recode (also used for answer-key scoring)
# ---------------------------------------------------------------------------
def _num(v) -> float | None:
    if isinstance(v, bool):
        return float(v)
    if isinstance(v, (int, float)) and not (isinstance(v, float) and math.isnan(v)):
        return float(v)
    if isinstance(v, str):
        try:
            f = float(v.strip())
        except ValueError:
            return None
        return f if math.isfinite(f) else None
    return None


def _same(x, target) -> bool:
    nx, nt = _num(x), _num(target)
    if nx is not None and nt is not None:
        return nx == nt
    return str(x).strip() == str(target).strip()


def recode_values(df: pd.DataFrame, var: dict, rules: list[dict], unmatched: str) -> list:
    """Python list of output values (None = missing). Missing inputs stay missing."""
    col = df[var["name"]]
    ok = valid_mask(col, var)
    raw = col.astype(object).tolist()
    out: list = []
    for x, good in zip(raw, ok):
        if not good:
            out.append(None)
            continue
        hit, val = False, None
        for r in rules:
            if r.get("from_values") is not None:
                if any(_same(x, fv) for fv in r["from_values"]):
                    hit, val = True, r["to"]
            elif r.get("from_range") is not None:
                nx = _num(x)
                if nx is not None and r["from_range"]["min"] <= nx <= r["from_range"]["max"]:
                    hit, val = True, r["to"]
            if hit:
                break
        if not hit:
            val = _plain(x) if unmatched == "keep" else None
        out.append(val)
    return out


def _plain(x):
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.floating,)):
        return float(x)
    if isinstance(x, (np.bool_,)):
        return bool(x)
    return x


def recode_output(values: list, source: dict, rules: list[dict], unmatched: str) -> tuple[str, pd.Series]:
    """Pick a storage dtype for recode output and build the typed column."""
    present = [v for v in values if v is not None]
    numeric = all(_num(v) is not None and not isinstance(v, str) for v in present)
    if unmatched == "keep" and source["dtype"] not in NUMERIC_DTYPES:
        numeric = numeric and all(not isinstance(v, str) for v in present)
    if numeric:
        if all(float(v).is_integer() for v in present):
            return "integer", pd.array([None if v is None else int(v) for v in values], dtype="Int64")
        return "float", pd.Series([np.nan if v is None else float(v) for v in values], dtype="float64").to_numpy()
    return "string", pd.array([None if v is None else str(v) for v in values], dtype=pd.StringDtype())


# ---------------------------------------------------------------------------
# Answer keys
# ---------------------------------------------------------------------------
def observed_answers(df: pd.DataFrame, var: dict) -> list:
    """Distinct real answers of an item, in first-seen order (stripped strings / numbers)."""
    col = df[var["name"]]
    ok = valid_mask(col, var)
    seen: dict[str, object] = {}
    for x, good in zip(col.astype(object).tolist(), ok):
        if not good:
            continue
        key = str(x).strip()
        if key and key not in seen:
            seen[key] = _plain(x).strip() if isinstance(x, str) else _plain(x)
    return list(seen.values())


def answer_key_rules(df: pd.DataFrame, var: dict, correct: list) -> tuple[list[dict], list[dict]]:
    """Recode rules scoring one item: correct answer(s) -> 1, every other observed answer -> 0.

    Keys are matched to the observed answers ignoring spaces and upper/lower case, so a key of
    'd' scores the answer 'D'. Blank / missing answers stay missing.
    """
    observed = observed_answers(df, var)
    by_fold = {str(o).strip().casefold(): o for o in observed}
    right, warns = [], []
    for c in correct:
        hit = by_fold.get(str(c).strip().casefold())
        if hit is None and _num(c) is not None:
            hit = next((o for o in observed if _same(o, c)), None)
        if hit is None:
            warns.append(warning(
                "key_not_observed",
                f"Nobody chose '{c}' on {var['name']}, the answer marked correct. Check the answer key for "
                "this question.", var["name"]))
            right.append(c)
        else:
            right.append(hit)
    wrong = [o for o in observed if not any(_same(o, r) for r in right)]
    rules = [{"from_values": right, "from_range": None, "to": 1}]
    if wrong:
        rules.append({"from_values": wrong, "from_range": None, "to": 0})
    return rules, warns


# ---------------------------------------------------------------------------
# Operands for difference / normalized gain
# ---------------------------------------------------------------------------
def operand_values(df: pd.DataFrame, meta: dict, by_name: dict[str, dict], operand: dict,
                   purpose: str) -> tuple[np.ndarray, list[dict]]:
    """Row values of an operand. With a time_level (linked long data), the participant's value at
    that time point is written onto every row of that participant (owner-approved rule)."""
    name = operand["variable"]
    if name not in by_name:
        raise InvalidParams(f"'{name}' is not in the dataset.", variable=name)
    x = numeric_values(df, by_name[name], purpose)
    level = operand.get("time_level")
    if level is None:
        return x, []
    stacking, link = meta.get("stacking"), meta.get("link") or {}
    if not stacking or link.get("mode") != "linked" or not link.get("id_variable"):
        raise InvalidParams(
            "To compare one time point with another for the same person, first link people across time "
            "(Data screen > Link people by an ID). Without linking, Statly can't tell which rows belong to "
            "the same person.")
    levels = [lvl["label"] for lvl in stacking["levels"]]
    if level not in levels:
        raise InvalidParams(f"'{level}' is not one of this dataset's time points ({', '.join(levels)}).")
    norm = link.get("normalization") or {"trim_whitespace": True, "case_insensitive": True}
    ids = df[link["id_variable"]].astype(object).map(
        lambda v: normalize_id(v, norm["trim_whitespace"], norm["case_insensitive"]))
    at = (df[stacking["time_variable"]].astype(object) == level).to_numpy(dtype=bool) & ids.notna().to_numpy()
    sub = pd.DataFrame({"id": ids[at].to_numpy(), "x": x[at]})
    dup = sub["id"].duplicated(keep=False)
    warns = []
    if dup.any():
        n = int(sub.loc[dup, "id"].nunique())
        warns.append(warning(
            "duplicate_ids_at_level",
            f"{n} ID{'s' if n != 1 else ''} appear more than once at {level}, so Statly can't tell which answer "
            "to use; those people get a missing value.", name))
    lookup = dict(zip(sub.loc[~dup, "id"], sub.loc[~dup, "x"]))
    vals = ids.map(lambda i: lookup.get(i, np.nan) if i is not None else np.nan)
    return vals.to_numpy(dtype="float64"), warns


def difference(df, meta, by_name, d) -> tuple[np.ndarray, list[dict]]:
    a, w1 = operand_values(df, meta, by_name, d["minuend"], "in a gain score")
    b, w2 = operand_values(df, meta, by_name, d["subtrahend"], "in a gain score")
    return a - b, w1 + w2


def normalized_gain(df, meta, by_name, d) -> tuple[np.ndarray, list[dict]]:
    pre, w1 = operand_values(df, meta, by_name, d["pre"], "in a normalized gain")
    post, w2 = operand_values(df, meta, by_name, d["post"], "in a normalized gain")
    mx = float(d["max_score"])
    warns = w1 + w2
    with np.errstate(divide="ignore", invalid="ignore"):
        g = (post - pre) / (mx - pre)
    at_max = int(np.sum(pre == mx))
    g = np.where(pre == mx, np.nan, g)
    if at_max:
        warns.append(warning(
            "gain_at_ceiling",
            f"{at_max} row{'s' if at_max != 1 else ''} already had the maximum score ({_fmt(mx)}) at the start, "
            "so there was no room to gain; their normalized gain is missing.", None))
    over = int(np.sum(pre > mx) + np.sum(post > mx))
    if over:
        warns.append(warning(
            "above_max_score",
            f"{over} score{'s are' if over != 1 else ' is'} higher than the maximum score you entered "
            f"({_fmt(mx)}). Check the maximum possible score.", None))
    return g, warns
