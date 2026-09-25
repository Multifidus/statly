"""Per-variable missing-data summary: blank cells vs declared missing codes (SPEC §5.5)."""

from __future__ import annotations

import pandas as pd


def coded_mask(col: pd.Series, missing_codes: list) -> pd.Series:
    """True where a non-blank cell equals a declared missing code."""
    if not missing_codes:
        return pd.Series(False, index=col.index)
    if pd.api.types.is_numeric_dtype(col) and not pd.api.types.is_bool_dtype(col):
        codes = []
        for c in missing_codes:
            try:
                codes.append(float(c))
            except (TypeError, ValueError):
                continue
        mask = col.astype("float64").isin(codes)
    else:
        codes = {str(c).strip() for c in missing_codes}
        mask = col.astype(object).map(lambda v: v is not None and v is not pd.NA and str(v).strip() in codes)
    return mask.fillna(False).astype(bool) & col.notna()


def variable_missing(col: pd.Series, name: str, missing_codes: list) -> dict:
    n_total = int(len(col))
    blank = int(col.isna().sum())
    coded = int(coded_mask(col, missing_codes).sum())
    missing = blank + coded
    return {
        "variable": name,
        "n_total": n_total,
        "n_valid": n_total - missing,
        "n_missing_blank": blank,
        "n_missing_coded": coded,
        "pct_missing": round(100.0 * missing / n_total, 4) if n_total else 0.0,
    }


def missing_summary(df: pd.DataFrame, variables: list[dict]) -> list[dict]:
    return [variable_missing(df[v["name"]], v["name"], v.get("missing_codes") or [])
            for v in variables if v["name"] in df.columns]
