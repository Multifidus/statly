"""Raw-string column typing: dtype inference, schema-driven coercion, JSON cells.

In-memory dtypes per VariableSchema.dtype:
  integer -> Int64, float -> float64 (NaN = missing), string -> pd.StringDtype(),
  boolean -> boolean, datetime -> datetime64[us].
"""

from __future__ import annotations

import datetime as _dt
import math
import re

import numpy as np
import pandas as pd

ISO_DATETIME_RE = r"^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$"
LEADING_ZERO_RE = r"^[+-]?0\d"
FLOAT_MARK_RE = r"[.eE]"
BOOL_TEXT = {"true": True, "false": False}
BOOL_COERCE = {"true": True, "false": False, "1": True, "0": False, "yes": True, "no": False}
MISSING_SENTINELS = (-9, -99, -999, -9999)
STRING_DTYPE = pd.StringDtype()


def _strip(raw: pd.Series) -> pd.Series:
    return raw.astype(object).where(raw.notna(), "").astype(str).str.strip()


def nonempty_values(raw: pd.Series) -> pd.Series:
    s = _strip(raw)
    return s[s != ""]


def parse_numbers(values: pd.Series) -> pd.Series:
    """Float parse of stripped strings; non-numbers, inf and nan text -> NaN."""
    num = pd.to_numeric(values, errors="coerce").astype("float64")
    return num.where(np.isfinite(num))


def infer_dtype(raw: pd.Series) -> str:
    vals = nonempty_values(raw)
    if vals.empty:
        return "string"
    low = vals.str.lower()
    if low.isin(BOOL_TEXT.keys()).all():
        return "boolean"
    if not vals.str.contains(LEADING_ZERO_RE, regex=True).any():
        num = parse_numbers(vals)
        if num.notna().all():
            integral = (num % 1 == 0).all() and (num.abs() < 2**53).all()
            if integral and not vals.str.contains(FLOAT_MARK_RE, regex=True).any():
                return "integer"
            return "float"
    if vals.str.match(ISO_DATETIME_RE).all():
        parsed = pd.to_datetime(vals, format="ISO8601", errors="coerce")
        if parsed.notna().all():
            return "datetime"
    return "string"


def sentinel_codes(num: pd.Series) -> list[int]:
    """Negative 9-run sentinel values (-9, -99, ...) in an otherwise non-negative column."""
    num = num.dropna()
    found = [c for c in MISSING_SENTINELS if (num == c).any()]
    if not found:
        return []
    rest = num[~num.isin(found)]
    if len(rest) and (rest < 0).any():
        return []
    return found


class CoercionError(ValueError):
    def __init__(self, n_bad: int, examples: list[str]):
        super().__init__(f"{n_bad} value(s) could not be converted (e.g. {', '.join(repr(e) for e in examples)})")
        self.n_bad = n_bad
        self.examples = examples


def _label_map(value_labels: list[dict]) -> dict[str, object]:
    return {str(vl["label"]).strip().casefold(): vl["value"] for vl in value_labels}


def coerce(raw: pd.Series, dtype: str, value_labels: list[dict] | None = None) -> pd.Series:
    """Convert raw strings to the schema dtype. Numeric dtypes accept numbers first,
    then answer text matching a value label (choice-text recoding). Never drops data
    silently: any non-empty cell that cannot be converted raises CoercionError."""
    n = len(raw)
    index = raw.index
    if dtype == "string":
        out = raw.astype(object).where(raw.notna(), "")
        out = out.where(out != "", None)
        return pd.Series(pd.array(out.tolist(), dtype=STRING_DTYPE), index=index)

    s = _strip(raw)
    empty = s == ""
    bad = pd.Series(False, index=index)

    if dtype in ("integer", "float"):
        num = parse_numbers(s.where(~empty, None))
        unresolved = ~empty & num.isna()
        if unresolved.any() and value_labels:
            lm = _label_map(value_labels)
            mapped = s[unresolved].str.casefold().map(lambda t: lm.get(t))
            mapped_num = pd.to_numeric(mapped, errors="coerce")
            num.loc[mapped_num.index] = mapped_num.astype("float64")
        bad = ~empty & num.isna()
        if dtype == "integer":
            frac = num.notna() & (num % 1 != 0)
            bad |= frac
            if bad.any():
                _raise(s, bad)
            return pd.Series(pd.array(num.round().tolist(), dtype="Int64"), index=index).where(num.notna(), pd.NA)
        if bad.any():
            _raise(s, bad)
        return num.astype("float64")

    if dtype == "boolean":
        mapped = s.str.lower().map(lambda t: BOOL_COERCE.get(t))
        bad = ~empty & mapped.isna()
        if bad.any():
            _raise(s, bad)
        return pd.Series(pd.array(mapped.tolist(), dtype="boolean"), index=index)

    if dtype == "datetime":
        parsed = pd.to_datetime(s.where(~empty, None), format="ISO8601", errors="coerce")
        bad = ~empty & parsed.isna()
        if bad.any():
            _raise(s, bad)
        return parsed.astype("datetime64[us]")

    raise ValueError(f"unknown dtype {dtype!r} (n={n})")


def _raise(s: pd.Series, bad: pd.Series):
    examples = list(dict.fromkeys(s[bad].tolist()))[:3]
    raise CoercionError(int(bad.sum()), examples)


# ---------------------------------------------------------------------------
# Multi-select
# ---------------------------------------------------------------------------
_COMMA_RE = re.compile(r"\s*,\s*")


def split_tokens(value: str) -> list[str]:
    return [t.strip() for t in str(value).split(",") if t.strip()]


def _norm_option(text: str) -> str:
    return _COMMA_RE.sub(",", str(text).strip()).casefold()


def split_selected(value: str, options: list[str] | None = None) -> list[str]:
    """Split one multi-select cell into the chosen options.

    Qualtrics joins choices with commas, so an option that itself contains a comma
    ("Other, please specify") is ambiguous. Known `options` are matched greedily (longest
    first) at each position, ignoring spacing around commas; text that matches no known
    option falls back to plain comma splitting."""
    if not options:
        return split_tokens(value)
    known = sorted({_norm_option(o): str(o).strip() for o in options if str(o).strip()}.items(),
                   key=lambda kv: len(kv[0]), reverse=True)
    text = _norm_option(value)
    out, i, n = [], 0, len(text)
    while i < n:
        while i < n and text[i] == ",":
            i += 1
        if i >= n:
            break
        for key, canonical in known:
            j = i + len(key)
            if text.startswith(key, i) and (j == n or text[j] == ","):
                out.append(canonical)
                i = j
                break
        else:
            j = text.find(",", i)
            j = n if j < 0 else j
            if text[i:j].strip():
                out.append(text[i:j].strip())
            i = j
    return out


def multiselect_indicator(raw: pd.Series, option: str, options: list[str] | None = None) -> pd.Series:
    """1 = option selected, 0 = answered without it, NA = question left blank.

    `options` is the column's full option list (see `split_selected`)."""
    key = _norm_option(option)
    opts = list(options or []) + [option]
    s = _strip(raw)
    vals = s.map(lambda v: None if v == "" else int(key in {_norm_option(t) for t in split_selected(v, opts)}))
    return pd.Series(pd.array(vals.tolist(), dtype="Int64"), index=raw.index)


# ---------------------------------------------------------------------------
# JSON cells
# ---------------------------------------------------------------------------
def to_cell(value):
    if value is None or value is pd.NA or value is pd.NaT:
        return None
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        f = float(value)
        return None if math.isnan(f) or math.isinf(f) else f
    if isinstance(value, (pd.Timestamp, _dt.datetime)):
        return value.isoformat(sep=" ")
    if isinstance(value, _dt.date):
        return value.isoformat()
    return str(value)


def frame_to_rows(df: pd.DataFrame) -> list[list]:
    cols = [df[c].astype(object).tolist() for c in df.columns]
    return [[to_cell(col[i]) for col in cols] for i in range(len(df))]


_SLUG_RE = re.compile(r"[^0-9A-Za-z]+")


def slug(text: str) -> str:
    return _SLUG_RE.sub("_", text).strip("_") or "option"
