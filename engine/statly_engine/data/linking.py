"""Aggregate vs linked mode: ID normalization and matched/unmatched/duplicate report (SPEC §5.4)."""

from __future__ import annotations

import pandas as pd

MAX_IDS = 200


def normalize_id(value, trim_whitespace: bool, case_insensitive: bool) -> str | None:
    if value is None or value is pd.NA or (isinstance(value, float) and value != value):
        return None
    s = str(value)
    if trim_whitespace:
        s = s.strip()
    if case_insensitive:
        s = s.upper()
    return s or None


def link_report(df: pd.DataFrame, id_variable: str, time_variable: str, levels: list[str],
                normalization: dict) -> tuple[dict, dict]:
    """Returns (LinkCounts, LinkReport) as contract dicts."""
    trim = normalization["trim_whitespace"]
    fold = normalization["case_insensitive"]
    ids = df[id_variable].astype(object).map(lambda v: normalize_id(v, trim, fold))
    times = df[time_variable].astype(object)
    per_level: dict[str, pd.Series] = {}
    for lvl in levels:
        per_level[lvl] = ids[(times == lvl) & ids.notna()]
    sets = {lvl: set(s) for lvl, s in per_level.items()}
    all_ids = set().union(*sets.values()) if sets else set()
    matched = set.intersection(*sets.values()) if sets else set()
    unmatched = all_ids - matched
    duplicates: dict[str, list[str]] = {}
    for lvl, s in per_level.items():
        for d in sorted(s[s.duplicated()].unique()):
            duplicates.setdefault(d, []).append(lvl)
    blank = int(ids.isna().sum())

    counts = {"matched": len(matched), "unmatched": len(unmatched), "duplicate": len(duplicates)}
    only_parts = []
    for lvl in levels:
        missing_elsewhere = sets[lvl] - matched
        if missing_elsewhere:
            only_parts.append(f"{len(missing_elsewhere)} seen at {lvl} but missing from another time point")
    lines = [
        f"{len(matched)} participants were matched across all {len(levels)} time points "
        f"({', '.join(levels)}) after {'trimming spaces and ' if trim else ''}"
        f"{'ignoring upper/lower case' if fold else 'exact comparison'}.",
    ]
    if unmatched:
        lines.append(
            f"{len(unmatched)} IDs are not present at every time point ({'; '.join(only_parts)}). "
            "They stay in aggregate (between-groups) analyses but are left out of paired and "
            "repeated-measures analyses, which need the same person at every time point."
        )
    if duplicates:
        shown = ", ".join(f"{d} ({'/'.join(l)})" for d, l in list(duplicates.items())[:10])
        lines.append(
            f"{len(duplicates)} IDs appear more than once within a single time point ({shown}). "
            "Paired analyses can't tell which row belongs to the person; review these before running them."
        )
    if blank:
        lines.append(f"{blank} rows have no ID and cannot be linked.")
    report = {
        "counts": counts,
        "unmatched_ids": sorted(unmatched)[:MAX_IDS],
        "duplicate_ids": list(duplicates)[:MAX_IDS],
        "explanation": " ".join(lines),
    }
    return counts, report
