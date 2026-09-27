"""Match a parsed Qualtrics survey (`survey_qsf.Survey`) to a dataset's variables.

Pure and deterministic: (survey, variables) -> suggestions. Nothing is written; the caller
decides which suggestions to apply. A suggestion never silently replaces what the user set:
fields whose current value is non-empty and different are listed in `differs_from_current`.

Output:
  {"columns":  [{name, survey_column, question_tag, label, question_text, value_labels, level,
                 question_kind, role?, reverse_hint?, correct_values?, notes,
                 differs_from_current}],                                # dataset order
   "scales":   [{name, label, items, origin, reverse_hint_items}],       # survey order
   "unmatched": {"survey_columns": [...], "dataset_columns": [...]}}
Levels are in the variable contract's vocabulary (nominal | ordinal | continuous).
"""

from __future__ import annotations

import re

from statly_engine.data import qualtrics as qx
from statly_engine.data.survey_qsf import ColumnSpec, Question, Survey

LEVEL_TO_CONTRACT = {"nominal": "nominal", "ordinal": "ordinal", "scale": "continuous", "text": "nominal"}
REVERSE_RE = re.compile(r"\breverse[- ]?(?:worded|scored|coded|keyed)\b|\(\s*R\s*\)\s*$|\breversed\b", re.IGNORECASE)
MIN_SCALE_ITEMS = 3


def _is_question_column(v: dict) -> bool:
    """Dataset columns expected to come from a survey question (not metadata/timing/score/computed)."""
    name = str(v.get("name", ""))
    if v.get("is_metadata") or v.get("computed") or name.startswith("_statly"):
        return False
    return not (qx.is_metadata_name(name) or qx.is_timing_name(name) or qx.is_score_name(name))


def _differs(current: dict, field: str, suggested) -> bool:
    cur = current.get(field)
    if cur in (None, "", []) or (field == "label" and cur == current.get("name")):
        return False
    return cur != suggested


def _suggestion(v: dict, col: ColumnSpec, q: Question, *, value_labels=None, level=None, notes=()) -> dict:
    vls = col.value_labels if value_labels is None else value_labels
    lvl = LEVEL_TO_CONTRACT.get(level or col.level, "nominal")
    s = {
        "name": v["name"], "survey_column": col.name, "question_tag": q.tag,
        "label": col.label, "question_text": q.text,
        "value_labels": [dict(x) for x in vls], "level": lvl,
    }
    s["question_kind"] = q.kind
    if col.correct_values and q.kind == "single" and value_labels is None:
        s["correct_values"] = list(col.correct_values)
    if col.level == "text":
        s["role"] = "open_text"
    elif q.kind == "matrix" and col.level == "ordinal":
        s["role"] = "likert_item"
    if q.kind == "matrix" and col.level == "ordinal" and REVERSE_RE.search(col.label):
        s["reverse_hint"] = True
    notes = list(notes)
    dtype = v.get("dtype")
    if dtype == "string" and vls and all(isinstance(x["value"], (int, float)) for x in vls) and value_labels is None:
        notes.append("The dataset stores answer text here; the survey's numeric codes apply once it is "
                     "converted to numbers.")
    s["notes"] = notes
    s["differs_from_current"] = [f for f in ("label", "question_text", "value_labels", "level")
                                 if _differs(v, f, s[f])]
    return s


def suggest_metadata(survey: Survey, variables: list[dict]) -> dict:
    """Suggestions for `variables` (dicts with at least `name`, optionally current metadata)."""
    by_exact = {str(v["name"]): v for v in variables}
    by_fold: dict[str, dict] = {}
    for v in variables:
        by_fold.setdefault(str(v["name"]).casefold(), v)

    def find(name: str) -> dict | None:
        return by_exact.get(name) or by_fold.get(name.casefold())

    matched: dict[str, dict] = {}          # dataset name -> suggestion
    unmatched_survey: list[str] = []
    col_to_dataset: dict[str, str] = {}    # survey column -> dataset name
    for q in survey.questions:
        if q.in_trash or not q.columns:
            continue
        # A multi-answer question exported as one comma-joined column (tag) instead of tag_<choice>.
        option_cols = [c for c in q.columns if c.level != "text"]
        joined = find(q.tag) if q.kind == "multi" and not any(find(c.name) for c in option_cols) else None
        if joined is not None and joined["name"] not in matched:
            opts = [c.value_labels[0]["label"] for c in option_cols if c.value_labels]
            carrier = ColumnSpec(q.tag, q.text, [], "nominal")
            matched[joined["name"]] = _suggestion(
                joined, carrier, q, value_labels=[{"value": o, "label": o} for o in opts], level="nominal",
                notes=["Exported as one 'select all that apply' column; options listed in survey order."])
            for c in option_cols:
                col_to_dataset[c.name] = joined["name"]
        for c in q.columns:
            if c.name in col_to_dataset:
                continue
            v = find(c.name)
            if v is None or v["name"] in matched:
                unmatched_survey.append(c.name)
                continue
            matched[v["name"]] = _suggestion(v, c, q)
            col_to_dataset[c.name] = v["name"]

    scales = []
    for sc in survey.suggested_scales():
        items = [col_to_dataset[i] for i in sc["items"] if i in col_to_dataset]
        if len(items) >= MIN_SCALE_ITEMS:
            scales.append({"name": sc["name"], "label": sc["label"], "items": items, "origin": "matrix_suggestion",
                           "reverse_hint_items": [i for i in items if matched[i].get("reverse_hint")]})

    columns = [matched[str(v["name"])] for v in variables if str(v["name"]) in matched]
    unmatched_dataset = [str(v["name"]) for v in variables
                         if str(v["name"]) not in matched and _is_question_column(v)]
    return {"columns": columns, "scales": scales,
            "unmatched": {"survey_columns": unmatched_survey, "dataset_columns": unmatched_dataset}}
