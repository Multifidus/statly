"""Multi-file stacking: column matching across files (SPEC §5.3).

Columns are matched by exact short ID first; columns left over (missing from at
least one file) are paired by fuzzy question-text similarity (difflib) and
reported as `possibly_renamed` for the user to confirm on the review screen.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

RENAME_THRESHOLD = 0.8
SAME_ID_TEXT_WARN = 0.6


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().casefold()


def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, _norm(a), _norm(b)).ratio()


def propose_matches(sources: list[tuple[str, list[tuple[str, str | None]]]]) -> tuple[list[dict], list[dict]]:
    """sources: [(file_id, [(column, question_text), ...]), ...] in time order.

    Returns (ColumnMatch dicts, ImportIssue dicts)."""
    file_ids = [fid for fid, _ in sources]
    groups: dict[str, dict] = {}
    order: list[str] = []
    issues: list[dict] = []
    for fid, cols in sources:
        for col, text in cols:
            g = groups.get(col)
            if g is None:
                g = groups[col] = {"variable": col, "cols": {}, "texts": {}, "similarity": None, "renamed": False}
                order.append(col)
            g["cols"][fid] = col
            g["texts"][fid] = text if text else col

    for key in order:
        g = groups[key]
        texts = list(g["texts"].values())
        if len(texts) >= 2 and any(similarity(texts[0], t) < SAME_ID_TEXT_WARN for t in texts[1:]):
            issues.append({
                "code": "same_id_different_text", "severity": "caution", "file_id": None, "column": key,
                "message": (f"'{key}' exists in several files but its question text differs a lot between "
                            "them. Check that it is really the same question before stacking."),
            })

    partial = [k for k in order if len(groups[k]["cols"]) < len(file_ids)]
    candidates = []
    for i, a in enumerate(partial):
        for b in partial[i + 1:]:
            if set(groups[a]["cols"]) & set(groups[b]["cols"]):
                continue
            ta = next(iter(groups[a]["texts"].values()))
            tb = next(iter(groups[b]["texts"].values()))
            sim = similarity(ta, tb)
            if sim >= RENAME_THRESHOLD:
                candidates.append((sim, order.index(a), order.index(b), a, b))
    absorbed: set[str] = set()
    for sim, _, _, a, b in sorted(candidates, key=lambda c: (-c[0], c[1], c[2])):
        if a in absorbed or b in absorbed:
            continue
        ga, gb = groups[a], groups[b]
        if set(ga["cols"]) & set(gb["cols"]):
            continue
        ga["cols"].update(gb["cols"])
        ga["texts"].update(gb["texts"])
        ga["renamed"] = True
        ga["similarity"] = sim if ga["similarity"] is None else min(ga["similarity"], sim)
        absorbed.add(b)

    matches = []
    for key in order:
        if key in absorbed:
            continue
        g = groups[key]
        if g["renamed"]:
            status = "possibly_renamed"
        elif len(g["cols"]) == len(file_ids):
            status = "matched"
        else:
            status = "unmatched"
        matches.append({
            "variable": key,
            "status": status,
            "similarity": round(g["similarity"], 4) if g["similarity"] is not None else None,
            "columns": [{"file_id": fid, "column": g["cols"][fid]} for fid in file_ids if fid in g["cols"]],
        })
    return matches, issues


def unique_name(base: str, taken: set[str]) -> str:
    name, k = base, 2
    while name in taken:
        name, k = f"{base}_{k}", k + 1
    return name
