"""Recode a free-text survey column into integer codes using a user-supplied ordered list
of labels (SPEC §6): for wording RESPONSE_SETS doesn't recognize, so the column can still
be scored and reverse-coded.

Pure functions: (data, variables, ...) -> new copies. Nothing here mutates its inputs.
"""

from __future__ import annotations

import copy
import math

import pandas as pd

from statly_engine.data.scoring import NUMERIC_DTYPES
from statly_engine.errors import InvalidParams

MAX_EXAMPLES = 10


def _norm(x: str, *, case_insensitive: bool, strip: bool) -> str:
    s = str(x)
    if strip:
        s = s.strip()
    if case_insensitive:
        s = s.casefold()
    return s


def _is_blank(x) -> bool:
    if x is None or x is pd.NA:
        return True
    if isinstance(x, float) and math.isnan(x):
        return True
    return False


def _by_name(variables: list[dict]) -> dict[str, dict]:
    return {v["name"]: v for v in variables}


def observed_text_levels(data: pd.DataFrame, name: str) -> list[str]:
    """Distinct trimmed values of a text column, in first-seen order (for the UI's ordering step)."""
    if name not in data.columns:
        raise InvalidParams(f"There is no column called '{name}'.", variable=name)
    col = data[name]
    seen: set[str] = set()
    out: list[str] = []
    for x in col.astype(object).tolist():
        if _is_blank(x):
            continue
        s = str(x).strip()
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


def recode_text_to_codes(data: pd.DataFrame, variables: list[dict], name: str, ordered_labels: list[str], *,
                          case_insensitive: bool = True, strip: bool = True) -> tuple[pd.DataFrame, list[dict], dict]:
    """Recode a text column into 1..k integer codes, in the given label order.

    Values that don't match any label become missing (counted in the returned report).
    The variable's dtype becomes "integer", level "ordinal", and value_labels are set from
    ordered_labels; missing_codes are preserved. Rejects an already-numeric column and an
    empty label list. Pure: returns new objects, never mutates `data` or `variables`.
    """
    by_name = _by_name(variables)
    var = by_name.get(name)
    if var is None:
        raise InvalidParams(f"There is no variable called '{name}'.", variable=name)
    if name not in data.columns:
        raise InvalidParams(f"There is no column called '{name}'.", variable=name)
    if not ordered_labels:
        raise InvalidParams("Give at least one answer label, in order, to recode this column.", variable=name)
    if var["dtype"] in NUMERIC_DTYPES:
        raise InvalidParams(
            f"'{name}' already holds numbers, so there is nothing to recode. Choose a text column instead.",
            variable=name)

    lookup: dict[str, int] = {}
    for i, label in enumerate(ordered_labels):
        key = _norm(label, case_insensitive=case_insensitive, strip=strip)
        lookup[key] = i + 1

    col = data[name]
    codes: list[int | None] = []
    matched = 0
    unmatched_count = 0
    examples: list[str] = []
    for x in col.astype(object).tolist():
        if _is_blank(x):
            codes.append(None)
            continue
        key = _norm(x, case_insensitive=case_insensitive, strip=strip)
        code = lookup.get(key)
        if code is None:
            codes.append(None)
            unmatched_count += 1
            raw = str(x).strip() if strip else str(x)
            if len(examples) < MAX_EXAMPLES:
                examples.append(raw)
        else:
            codes.append(code)
            matched += 1

    new_data = data.copy()
    new_data[name] = pd.array(codes, dtype="Int64")

    new_variables = copy.deepcopy(variables)
    new_var = next(v for v in new_variables if v["name"] == name)
    new_var["dtype"] = "integer"
    new_var["level"] = "ordinal"
    new_var["value_labels"] = [{"value": i + 1, "label": label} for i, label in enumerate(ordered_labels)]

    report = {
        "variable": name,
        "matched": matched,
        "unmatched": {"count": unmatched_count, "examples": examples},
    }
    return new_data, new_variables, report
